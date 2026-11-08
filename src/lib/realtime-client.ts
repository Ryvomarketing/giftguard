import type { CommandResult } from './types';
import { savedActivity, toolActivity, type AgentActivity } from './agent-activity';

export type LiveVoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused';
export type LiveVoiceCallbacks = {
  onStatus(status: LiveVoiceStatus): void;
  onTranscript(entry: { id: string; role: 'user' | 'assistant'; text: string }): void;
  onResult(result: CommandResult): void;
  onError(message: string): void;
  onAudioBlocked?(): void;
  onActivity?(activity: AgentActivity | null): void;
};

/** Browser dependencies are injectable so cancellation and connection races can be tested. */
export interface VoicePlatform {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeer(): RTCPeerConnection;
  createAudio(): HTMLAudioElement;
  createStream(tracks: MediaStreamTrack[]): MediaStream;
  fetch: typeof fetch;
  setTimer(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
}
const browser: VoicePlatform = {
  getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  createPeer: () => new RTCPeerConnection(),
  createAudio: () => new Audio(),
  createStream: tracks => new MediaStream(tracks),
  fetch: (...args) => fetch(...args),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: timer => clearTimeout(timer),
};
type FunctionCall = { type: 'function_call'; call_id: string; name: string; arguments: string };
type ServerEvent = {
  type?: string; item_id?: string; response_id?: string; delta?: string; transcript?: string;
  response?: { id?: string; status?: string; output?: unknown[] };
};

const connectionFailure = 'Live voice could not connect. Please check your connection and server setup.';
class ConnectionError extends Error {}
class ToolRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
class SignedOutError extends Error {}
const signedOutMessage = 'Your GiftGuard sign-in has expired, usually because the server restarted. Refresh the page, sign in again, then reconnect live voice.';

async function connectionMessage(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return connectionFailure;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel(); return connectionFailure; }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const message = value && typeof value === 'object' && 'error' in value ? value.error : null;
    if (typeof message !== 'string' || !message.trim() || message.length > 350 || /sk-[a-z0-9_-]+|bearer\s+\S+/i.test(message)) return connectionFailure;
    return message.replace(/\s+/g, ' ').trim();
  } catch { return connectionFailure; }
  finally { reader.releaseLock(); }
}

// Presentation IDs must remain distinct across newly connected client instances.
let activitySessionSequence = 0;

/** One WebRTC audio tunnel. Tool execution never calls a confirmation endpoint. */
export class LiveVoiceSession {
  private readonly activitySession = ++activitySessionSequence;
  private epoch = 0;
  private active = false;
  private ready = false;
  private muted = false;
  private paused = false;
  private reviewPending = false;
  private proposalInFlight = false;
  private contextDonorId: string | null = null;
  private status: LiveVoiceStatus = 'idle';
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private capture: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private controller: AbortController | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private responseActive = false;
  private responseId: string | undefined;
  private speaking = false;
  private userSpeaking = false;
  private awaitingVoiceResponse = false;
  private userTurn = 0;
  private toolsInFlight = 0;
  private pendingContinuation: number | null = null;
  private pendingText = false;
  private sequence = 0;
  private calls = new Set<string>();
  private completedResponses = new Set<string>();
  private responseTurns = new Map<string, number>();
  private transcripts = new Map<string, string>();
  private activityVersion = 0;
  private activity: AgentActivity | null = null;

  constructor(private callbacks: LiveVoiceCallbacks, private platform: VoicePlatform = browser) {}

  async connect(): Promise<void> {
    if (this.active) return;
    this.active = true;
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    this.updateStatus();
    this.connectionTimer = this.platform.setTimer(() => {
      if (this.current(epoch) && !this.ready) this.fail('Live voice took too long to connect. Please try again.');
    }, 20_000);
    try {
      const peer = this.platform.createPeer();
      this.peer = peer;
      const audio = this.platform.createAudio();
      audio.autoplay = true;
      this.audio = audio;
      peer.ontrack = event => {
        if (!this.current(epoch)) return;
        audio.srcObject = event.streams[0] ?? this.platform.createStream([event.track]);
        void this.resumeAudio();
      };
      peer.onconnectionstatechange = () => {
        if (!this.current(epoch)) return;
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
          this.fail('The live voice connection ended. Please reconnect.');
        } else this.checkReady();
      };
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onopen = () => { if (this.current(epoch)) this.checkReady(); };
      channel.onclose = () => { if (this.current(epoch)) this.fail('The live voice connection ended. Please reconnect.'); };
      channel.onerror = () => { if (this.current(epoch)) this.fail('Live voice could not keep its connection. Please reconnect.'); };
      channel.onmessage = event => {
        if (!this.current(epoch) || typeof event.data !== 'string') return;
        try { this.handleEvent(JSON.parse(event.data) as ServerEvent, epoch); }
        catch { this.fail('Live voice returned an unreadable response. Please reconnect.'); }
      };
      const capture = await this.platform.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!this.current(epoch)) { capture.getTracks().forEach(track => track.stop()); return; }
      this.capture = capture;
      this.gateMicrophone();
      capture.getAudioTracks().forEach(track => {
        track.onended = () => { if (this.current(epoch)) this.fail('The microphone disconnected or access was removed. Please reconnect live voice.'); };
        peer.addTrack(track, capture);
      });
      const offer = await peer.createOffer();
      if (!this.current(epoch)) return;
      await peer.setLocalDescription(offer);
      if (!this.current(epoch)) return;
      const sdp = peer.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error('No connection offer.');
      const response = await this.platform.fetch('/api/realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: sdp, signal: controller.signal,
      });
      if (!this.current(epoch)) return;
      if (!response.ok) throw new ConnectionError(await connectionMessage(response));
      const answer = await response.text();
      if (!this.current(epoch)) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: answer });
      if (this.current(epoch)) this.checkReady();
    } catch (error) {
      if (!this.current(epoch) || controller.signal.aborted) return;
      this.fail(error instanceof ConnectionError ? error.message : error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone permission was declined. Allow microphone access to use live voice.'
        : connectionFailure);
    }
  }

  disconnect(): void {
    this.active = false;
    this.epoch++;
    this.clearActivity();
    this.controller?.abort(); this.controller = null;
    if (this.connectionTimer) this.platform.clearTimer(this.connectionTimer);
    this.connectionTimer = null;
    if (this.channel) {
      this.channel.onopen = null; this.channel.onclose = null; this.channel.onerror = null; this.channel.onmessage = null;
      this.channel.close(); this.channel = null;
    }
    if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; this.peer.close(); this.peer = null; }
    this.capture?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.capture = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; }
    this.ready = false; this.responseActive = false; this.responseId = undefined;
    this.speaking = false; this.userSpeaking = false; this.awaitingVoiceResponse = false;
    this.reviewPending = false; this.proposalInFlight = false;
    this.toolsInFlight = 0; this.pendingContinuation = null; this.pendingText = false; this.userTurn = 0;
    this.calls.clear(); this.completedResponses.clear(); this.responseTurns.clear(); this.transcripts.clear();
    this.updateStatus();
  }

  setMuted(muted: boolean): void { this.muted = muted; this.gateMicrophone(); this.updateStatus(); }
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.reviewPending = false;
      if (this.activity?.phase === 'review') this.clearActivity();
    }
    this.gateMicrophone(); this.updateStatus();
  }
  setContextDonor(donorId: string | null): void {
    if (donorId !== null && (typeof donorId !== 'string' || !donorId.trim() || donorId.length > 200)) return;
    const next = donorId?.trim() ?? null;
    if (next === this.contextDonorId) return;
    this.contextDonorId = next;
    if (this.ready) this.sendContext();
  }
  async resumeAudio(): Promise<boolean> {
    const audio = this.audio;
    if (!audio?.srcObject) return false;
    const epoch = this.epoch;
    try { await audio.play(); return this.current(epoch); }
    catch { if (this.current(epoch)) this.callbacks.onAudioBlocked?.(); return false; }
  }

  /** Acknowledge a completed server action; this never submits an approval. */
  notifyAction(message: string): void {
    if (!this.ready || !message.trim()) return;
    this.publishActivity(savedActivity(`receipt_${this.activitySession}_${this.epoch}_${++this.sequence}`, message));
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ ui_action_receipt: message.slice(0, 800) }) }] } });
    this.pendingText = true;
    this.continueResponse();
  }

  sendText(text: string): void {
    const trimmed = text.trim();
    if (!this.ready || !trimmed) return;
    if (trimmed.length > 1500) { this.callbacks.onError('Please keep your message under 1,500 characters.'); return; }
    this.userTurn++; this.clearActivity(); this.pendingContinuation = null; this.pendingText = true;
    this.awaitingVoiceResponse = false; this.userSpeaking = false;
    if (this.responseActive) this.send({ type: 'response.cancel' });
    if (this.speaking) this.send({ type: 'output_audio_buffer.clear' });
    this.speaking = false;
    const id = `client_text_${++this.sequence}`;
    this.send({ type: 'conversation.item.create', item: { id, type: 'message', role: 'user', content: [{ type: 'input_text', text: trimmed }] } });
    this.callbacks.onTranscript({ id, role: 'user', text: trimmed });
    this.continueResponse();
  }

  private publishActivity(activity: AgentActivity): number {
    const version = ++this.activityVersion;
    this.activity = activity;
    this.callbacks.onActivity?.(activity);
    return version;
  }
  private clearActivity(): void {
    this.activityVersion++;
    if (this.activity) { this.activity = null; this.callbacks.onActivity?.(null); }
  }
  private ownsActivity(version: number | undefined, epoch: number, turn: number): boolean {
    return version !== undefined && version === this.activityVersion && this.current(epoch) && turn === this.userTurn;
  }
  private current(epoch: number): boolean { return this.active && epoch === this.epoch; }
  private gateMicrophone(): void { this.capture?.getAudioTracks().forEach(track => { track.enabled = !this.muted && !this.paused && !this.reviewPending; }); }
  private fail(message: string): void { this.disconnect(); this.callbacks.onError(message); }
  private send(event: object): void {
    if (this.channel?.readyState !== 'open') return;
    try { this.channel.send(JSON.stringify(event)); }
    catch { this.fail('The live voice connection ended. Please reconnect.'); }
  }
  private updateStatus(): void {
    const next: LiveVoiceStatus = !this.active ? 'idle' : !this.ready ? 'connecting'
      : this.speaking ? 'speaking' : this.userSpeaking ? 'listening' : this.responseActive || this.toolsInFlight > 0 || this.awaitingVoiceResponse ? 'thinking'
      : this.muted || this.paused || this.reviewPending ? 'paused' : 'listening';
    if (next !== this.status) { this.status = next; this.callbacks.onStatus(next); }
  }
  private checkReady(): void {
    if (this.ready || !this.active || this.channel?.readyState !== 'open' || this.peer?.connectionState !== 'connected') return;
    this.ready = true;
    if (this.connectionTimer) this.platform.clearTimer(this.connectionTimer);
    this.connectionTimer = null;
    this.sendContext();
    this.updateStatus();
    if (this.userTurn === 0) {
      this.responseActive = true;
      this.send({ type: 'response.create', response: { instructions: 'Briefly greet the user as GiftGuard and ask how you can help with their donor work.' } });
      this.updateStatus();
    }
  }
  private sendContext(): void {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ ui_selected_donor: this.contextDonorId }) }] } });
  }
  private handleEvent(event: ServerEvent, epoch: number): void {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript && event.item_id) this.callbacks.onTranscript({ id: event.item_id, role: 'user', text: event.transcript });
        break;
      case 'response.output_audio_transcript.delta': {
        const id = event.item_id ?? event.response_id;
        if (id && event.delta) { const text = (this.transcripts.get(id) ?? '') + event.delta; this.transcripts.set(id, text); this.callbacks.onTranscript({ id, role: 'assistant', text }); }
        break;
      }
      case 'response.output_audio_transcript.done': {
        const id = event.item_id ?? event.response_id;
        if (id && typeof event.transcript === 'string') { this.transcripts.delete(id); this.callbacks.onTranscript({ id, role: 'assistant', text: event.transcript }); }
        break;
      }
      case 'input_audio_buffer.speech_started':
        this.userTurn++; this.clearActivity(); this.userSpeaking = true; this.awaitingVoiceResponse = true;
        this.pendingContinuation = null; this.pendingText = false; this.speaking = false;
        break;
      case 'input_audio_buffer.speech_stopped': this.userSpeaking = false; break;
      case 'output_audio_buffer.started': this.speaking = true; break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': this.speaking = false; break;
      case 'response.created':
        if (!event.response?.id || this.responseTurns.has(event.response.id)) break;
        this.responseTurns.set(event.response.id, this.userTurn);
        this.responseActive = true; this.responseId = event.response.id; this.awaitingVoiceResponse = false;
        break;
      case 'response.done': {
        if (!event.response?.id || this.completedResponses.has(event.response.id)) break;
        this.completedResponses.add(event.response.id);
        const responseTurn = this.responseTurns.get(event.response.id);
        if (event.response.id === this.responseId) { this.responseActive = false; this.responseId = undefined; }
        if (event.response.status === 'completed' && responseTurn !== undefined) {
          const calls = (event.response.output ?? []).filter((item): item is FunctionCall => {
            const call = item as Partial<FunctionCall> | null;
            return !!call && call.type === 'function_call' && typeof call.call_id === 'string' && typeof call.name === 'string' && typeof call.arguments === 'string';
          }).filter(call => {
            if (this.calls.has(call.call_id)) return false;
            this.calls.add(call.call_id); return true;
          });
          if (calls.length) void this.runTools(calls, epoch, responseTurn);
        }
        this.continueResponse();
        break;
      }
      case 'error': this.fail('The live voice service reported an error. Please reconnect.'); return;
    }
    this.updateStatus();
  }
  private async runTools(calls: FunctionCall[], epoch: number, turn: number): Promise<void> {
    this.toolsInFlight++;
    this.updateStatus();
    for (const call of calls) {
      if (!this.current(epoch)) return;
      let output: unknown;
      let activityVersion: number | undefined;
      let args: Record<string, unknown> | undefined;
      const activityId = `tool_${this.activitySession}_${epoch}_${call.call_id}`;
      const proposal = call.name === 'propose_change';
      const stale = proposal && turn !== this.userTurn;
      const blocked = proposal && (this.reviewPending || this.proposalInFlight || this.paused);
      if (stale) {
        output = { changesMade: false, proposalDisplayed: false, message: 'The user has started a newer request. No change was proposed from this older request.' };
      } else if (blocked) {
        output = { approval_required: true, changesMade: false, message: 'A staff review is already pending. Ask the user to finish or dismiss that on-screen review before proposing another change.' };
      } else {
        // Reserve synchronously, including across batches, before the request can yield.
        if (proposal) this.proposalInFlight = true;
        try {
          const parsed: unknown = JSON.parse(call.arguments);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid tool arguments.');
          args = parsed as Record<string, unknown>;
          if (turn === this.userTurn) {
            const working = toolActivity(activityId, call.name, args, 'working');
            if (working) activityVersion = this.publishActivity(working);
          }
          const response = await this.platform.fetch('/api/realtime/tool', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: call.name, arguments: args }),
            signal: AbortSignal.any([this.controller!.signal, AbortSignal.timeout(20_000)]),
          });
          if (!this.current(epoch)) return;
          if (response.status === 401) throw new SignedOutError();
          if (!response.ok) {
            // The server explains what to fix (an ID instead of a name, a missing date); the model gets that text so it can correct itself.
            const detail = await response.json().catch(() => null) as { error?: unknown } | null;
            throw new ToolRequestError(typeof detail?.error === 'string' ? detail.error : 'Tool request failed.', response.status);
          }
          const payload = await response.json() as { result?: CommandResult; output?: unknown };
          if (!this.current(epoch)) return;
          // Preserve the server's model-safe output even when no UI result was produced.
          output = payload?.output ?? { error: 'No tool result was returned.' };
          if (!payload?.result || typeof payload.result !== 'object' || typeof payload.result.message !== 'string' || !output || typeof output !== 'object' || Array.isArray(output) || 'error' in output) throw new Error('No successful tool result was returned.');
          let accepted = turn === this.userTurn;
          if (payload.result?.approval) {
            if (turn !== this.userTurn) {
              accepted = false;
              output = { changesMade: false, proposalDisplayed: false, message: 'The user has started a newer request. The older proposal was not displayed.' };
            } else if (this.paused || this.reviewPending) {
              accepted = false;
              output = { approval_required: true, changesMade: false, proposalDisplayed: false, message: 'Another staff review is already pending. This proposal was not displayed. Ask the user to finish or dismiss the existing on-screen review.' };
            } else {
              this.reviewPending = true; this.gateMicrophone();
              this.callbacks.onResult(payload.result);
            }
          } else if (payload.result && turn === this.userTurn) {
            this.callbacks.onResult(payload.result);
          }
          if (this.ownsActivity(activityVersion, epoch, turn)) {
            if (!accepted) this.clearActivity();
            else {
              const complete = toolActivity(activityId, call.name, args, 'complete', payload.result);
              if (complete) this.publishActivity(complete);
            }
          }
        } catch (error) {
          if (!this.current(epoch)) return;
          const signedOut = error instanceof SignedOutError;
          if (signedOut && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('giftguard:signed-out'));
          output ??= { error: signedOut ? 'The staff member is signed out of GiftGuard, so no records could be read. Ask them to refresh the page, sign in again and reconnect live voice.' : error instanceof ToolRequestError && error.status < 500 ? error.message : 'That request could not be completed. Ask the user to try again.' };
          if (args && this.ownsActivity(activityVersion, epoch, turn)) {
            const failed = toolActivity(activityId, call.name, args, 'failed');
            if (failed) this.publishActivity(failed);
          }
          if (turn === this.userTurn) this.callbacks.onError(signedOut ? signedOutMessage : 'That donor request could not be completed. You can try again.');
        } finally {
          if (proposal && this.current(epoch)) this.proposalInFlight = false;
        }
      }
      if (this.current(epoch)) this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) } });
    }
    if (!this.current(epoch)) return;
    this.toolsInFlight--;
    if (turn === this.userTurn) this.pendingContinuation = turn;
    this.continueResponse();
    this.updateStatus();
  }
  private continueResponse(): void {
    if (!this.ready || this.responseActive || this.userSpeaking || this.awaitingVoiceResponse || this.toolsInFlight > 0) return;
    if (!this.pendingText && this.pendingContinuation !== this.userTurn) return;
    this.pendingText = false; this.pendingContinuation = null; this.responseActive = true;
    this.send({ type: 'response.create' });
    this.updateStatus();
  }
}
