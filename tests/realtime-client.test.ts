import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveVoiceSession, type LiveVoiceStatus, type VoicePlatform } from '../src/lib/realtime-client';
import type { CommandResult } from '../src/lib/types';
import type { AgentActivity } from '../src/lib/agent-activity';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
class FakeTrack { enabled = true; stopped = false; onended: (() => void) | null = null; stop() { this.stopped = true; } }
class FakeStream {
  track = new FakeTrack();
  getTracks() { return [this.track] as unknown as MediaStreamTrack[]; }
  getAudioTracks() { return this.getTracks(); }
  asStream() { return this as unknown as MediaStream; }
}
class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  open() { this.readyState = 'open'; this.onopen?.(); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  event(event: object) { this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent); }
}
class FakePeer {
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  channel = new FakeChannel();
  channelName = '';
  addedTracks: MediaStreamTrack[] = [];
  createDataChannel(name: string) { this.channelName = name; return this.channel; }
  addTrack(track: MediaStreamTrack) { this.addedTracks.push(track); }
  async createOffer() { return { type: 'offer' as const, sdp: 'local-offer' }; }
  async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescription = description; }
  async setRemoteDescription(description: RTCSessionDescriptionInit) { this.remoteDescription = description; }
  state(state: RTCPeerConnectionState) { this.connectionState = state; this.onconnectionstatechange?.(); }
  close() { this.state('closed'); }
}
class FakeAudio {
  autoplay = false;
  srcObject: MediaProvider | null = null;
  paused = false;
  blocked = false;
  async play() { if (this.blocked) throw new Error('Autoplay blocked'); this.paused = false; }
  pause() { this.paused = true; }
}
function harness(options: { permission?: Promise<MediaStream>; fetch?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const peer = new FakePeer(), capture = new FakeStream(), audio = new FakeAudio();
  const statuses: LiveVoiceStatus[] = [], errors: string[] = [], results: CommandResult[] = [];
  const activities: (AgentActivity | null)[] = [];
  const lifecycle: string[] = [];
  const transcripts: { id: string; role: 'user' | 'assistant'; text: string }[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0, audioBlocked = 0;
  let constraints: MediaStreamConstraints | undefined;
  const platform: VoicePlatform = {
    getUserMedia: async value => { constraints = value; return options.permission ?? capture.asStream(); },
    createPeer: () => peer as unknown as RTCPeerConnection,
    createAudio: () => audio as unknown as HTMLAudioElement,
    createStream: () => capture.asStream(),
    fetch: async (url, init) => { requests.push({ url: String(url), init }); return options.fetch ? options.fetch(String(url), init) : new Response('remote-answer'); },
    setTimer: (callback, milliseconds) => { assert.equal(milliseconds, 20_000); timers.set(++nextTimer, callback); return nextTimer as unknown as ReturnType<typeof setTimeout>; },
    clearTimer: timer => { timers.delete(timer as unknown as number); },
  };
  const session = new LiveVoiceSession({ onStatus: status => statuses.push(status), onError: error => errors.push(error), onResult: result => { results.push(result); lifecycle.push('result'); }, onTranscript: entry => transcripts.push(entry), onAudioBlocked: () => { audioBlocked++; }, onActivity: activity => { activities.push(activity); lifecycle.push(`activity:${activity?.phase ?? 'clear'}`); } }, platform);
  function ready() { peer.channel.open(); peer.state('connected'); }
  function finishGreeting() { peer.channel.event({ type: 'response.created', response: { id: 'greeting' } }); peer.channel.event({ type: 'response.done', response: { id: 'greeting', status: 'completed', output: [] } }); }
  return { session, peer, capture, audio, statuses, errors, results, activities, lifecycle, transcripts, requests, timers, ready, finishGreeting, constraints: () => constraints, audioBlocked: () => audioBlocked };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const toolCall = (id = 'call1') => ({ type: 'function_call', call_id: id, name: 'giftguard_request', arguments: JSON.stringify({ request: 'Who needs a call?' }) });

test('WebRTC uses one SDP handshake and requires both peer and data channel before listening', async () => {
  const h = harness();
  await h.session.connect();
  assert.deepEqual(h.statuses, ['connecting']);
  assert.deepEqual(h.constraints(), { audio: { echoCancellation: true, noiseSuppression: true } });
  assert.equal(h.peer.channelName, 'oai-events');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/realtime');
  assert.equal(h.requests[0].init?.body, 'local-offer');
  assert.equal(new Headers(h.requests[0].init?.headers).get('content-type'), 'application/sdp');
  assert.deepEqual(h.peer.remoteDescription, { type: 'answer', sdp: 'remote-answer' });
  h.peer.channel.open(); assert.deepEqual(h.statuses, ['connecting']);
  h.peer.state('connected'); assert.ok(h.statuses.includes('listening'));
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(h.timers.size, 0);
  h.finishGreeting(); assert.equal(h.statuses.at(-1), 'listening');
  h.session.disconnect();
});

test('ending while microphone permission is pending stops late tracks and never sends SDP', async () => {
  const permission = deferred<MediaStream>(), h = harness({ permission: permission.promise });
  const connecting = h.session.connect();
  h.session.disconnect(); const count = h.statuses.length;
  permission.resolve(h.capture.asStream()); await connecting;
  assert.equal(h.capture.track.stopped, true);
  assert.equal(h.requests.length, 0); assert.equal(h.statuses.length, count); assert.equal(h.statuses.at(-1), 'idle');
});

test('ending during SDP exchange aborts fetch and ignores a late answer', async () => {
  const answer = deferred<Response>(); const h = harness({ fetch: () => answer.promise });
  const connecting = h.session.connect(); await settle();
  h.session.disconnect();
  assert.equal(h.requests[0].init?.signal?.aborted, true);
  answer.resolve(new Response('late-answer')); await connecting;
  assert.equal(h.peer.remoteDescription, null); assert.equal(h.capture.track.stopped, true);
});

test('timeout and connection loss release tracks, channel, audio and the peer', async () => {
  const h = harness(); await h.session.connect();
  [...h.timers.values()][0]();
  assert.equal(h.statuses.at(-1), 'idle'); assert.equal(h.capture.track.stopped, true);
  assert.equal(h.peer.channel.readyState, 'closed'); assert.match(h.errors[0], /too long/);
  const live = harness(); await live.session.connect(); live.ready();
  live.peer.ontrack?.({ streams: [live.capture.asStream()] } as unknown as RTCTrackEvent);
  live.peer.state('disconnected');
  assert.equal(live.audio.srcObject, null); assert.equal(live.audio.paused, true);
  assert.equal(live.capture.track.stopped, true); assert.equal(live.statuses.at(-1), 'idle');
});

test('microphone mute and approval pause compose without closing the audio session', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  h.session.setMuted(true); assert.equal(h.capture.track.enabled, false);
  h.session.setPaused(true); h.session.setMuted(false); assert.equal(h.capture.track.enabled, false);
  assert.equal(h.peer.connectionState, 'connected'); assert.equal(h.capture.track.stopped, false);
  h.peer.channel.event({ type: 'output_audio_buffer.started' }); assert.equal(h.statuses.at(-1), 'speaking');
  h.peer.channel.event({ type: 'output_audio_buffer.stopped' }); assert.equal(h.statuses.at(-1), 'paused');
  h.session.setPaused(false); assert.equal(h.capture.track.enabled, true); assert.equal(h.statuses.at(-1), 'listening');
  h.session.disconnect();
});

test('transcripts update by item identity and blocked audio can be resumed', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user1', transcript: 'Hello' });
  h.peer.channel.event({ type: 'response.output_audio_transcript.delta', item_id: 'reply1', delta: 'Hi ' });
  h.peer.channel.event({ type: 'response.output_audio_transcript.delta', item_id: 'reply1', delta: 'Denise' });
  h.peer.channel.event({ type: 'response.output_audio_transcript.done', item_id: 'reply1', transcript: 'Hi Denise.' });
  assert.deepEqual(h.transcripts.at(-1), { id: 'reply1', role: 'assistant', text: 'Hi Denise.' });
  h.audio.srcObject = h.capture.asStream(); h.audio.blocked = true;
  assert.equal(await h.session.resumeAudio(), false); assert.equal(h.audioBlocked(), 1);
  h.audio.blocked = false; assert.equal(await h.session.resumeAudio(), true);
  h.session.disconnect();
});

test('argument-completed and cancelled responses never execute tools', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ ...toolCall(), type: 'response.function_call_arguments.done' });
  h.peer.channel.event({ type: 'response.created', response: { id: 'cancelled' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'cancelled', status: 'cancelled', output: [toolCall()] } });
  await settle(); assert.equal(h.requests.filter(r => r.url.includes('/tool')).length, 0);
  h.session.disconnect();
});

test('completed tools deduplicate call IDs and expose approval only to the UI', async () => {
  const result: CommandResult = { message: 'Please review these donors.', mode: 'ai', approval: { id: 'PRIVATE_APPROVAL_TOKEN', title: 'Combine?', description: 'Review', items: ['Rosa'], action: { type: 'merge', candidateIds: ['match1'] }, expiresAt: '2026-11-08' } };
  const h = harness({ fetch: async url => url.endsWith('/tool') ? Response.json({ result, output: { message: 'Staff confirmation is required.' } }) : new Response('answer') });
  await h.session.connect(); h.ready(); h.finishGreeting();
  const event = { type: 'response.done', response: { id: 'tools1', status: 'completed', output: [toolCall(), toolCall()] } };
  h.peer.channel.event({ type: 'response.created', response: { id: 'tools1' } });
  h.peer.channel.event(event); h.peer.channel.event(event); await settle(); await settle();
  assert.equal(h.requests.filter(r => r.url.endsWith('/tool')).length, 1);
  assert.equal(h.results[0].approval?.id, 'PRIVATE_APPROVAL_TOKEN');
  assert.equal(JSON.stringify(h.peer.channel.sent).includes('PRIVATE_APPROVAL_TOKEN'), false);
  const outputs = h.peer.channel.sent.filter(e => e.type === 'conversation.item.create' && (e.item as { type: string }).type === 'function_call_output');
  assert.equal(outputs.length, 1); assert.deepEqual(JSON.parse((outputs[0].item as { output: string }).output), { message: 'Staff confirmation is required.' });
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.create').length, 2);
  assert.equal(h.requests.some(r => r.url.includes('/confirm')), false);
  h.session.disconnect();
});

test('a new spoken turn suppresses stale tool continuation and disconnect suppresses late UI results', async () => {
  const tool = deferred<Response>();
  const h = harness({ fetch: url => url.endsWith('/tool') ? tool.promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'tools' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'tools', status: 'completed', output: [toolCall()] } });
  h.peer.channel.event({ type: 'input_audio_buffer.speech_started' });
  h.peer.channel.event({ type: 'input_audio_buffer.speech_stopped' });
  tool.resolve(Response.json({ result: { message: 'Earlier navigation', view: 'donors', mode: 'ai' }, output: { message: 'Earlier result' } })); await settle(); await settle();
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(h.results.length, 0);
  h.session.disconnect();
  const late = deferred<Response>();
  const ended = harness({ fetch: url => url.endsWith('/tool') ? late.promise : Promise.resolve(new Response('answer')) });
  await ended.session.connect(); ended.ready(); ended.finishGreeting();
  ended.peer.channel.event({ type: 'response.created', response: { id: 'later' } });
  ended.peer.channel.event({ type: 'response.done', response: { id: 'later', status: 'completed', output: [toolCall()] } });
  ended.session.disconnect(); late.resolve(Response.json({ result: { message: 'stale', mode: 'ai' }, output: { message: 'stale' } })); await settle();
  assert.equal(ended.results.length, 0);
});

test('typed interruption waits for cancellation before requesting another response', async () => {
  const h = harness(); await h.session.connect(); h.ready();
  h.peer.channel.event({ type: 'response.created', response: { id: 'greeting' } });
  h.session.sendText('Who needs a call?');
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.create').length, 1);
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.cancel').length, 1);
  h.peer.channel.event({ type: 'response.done', response: { id: 'greeting', status: 'cancelled', output: [] } });
  assert.equal(h.peer.channel.sent.filter(e => e.type === 'response.create').length, 2);
  h.session.disconnect();
});


test('revoked microphone access ends the session and explicit teardown removes ended listeners', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  h.capture.track.onended?.();
  assert.equal(h.statuses.at(-1), 'idle'); assert.equal(h.capture.track.stopped, true);
  assert.match(h.errors[0], /microphone disconnected/); assert.equal(h.capture.track.onended, null);
  const ended = harness(); await ended.session.connect(); ended.ready(); ended.session.disconnect();
  assert.equal(ended.capture.track.onended, null); assert.equal(ended.errors.length, 0);
});

test('selected donor context is buffered before connection and syncs without starting responses', async () => {
  const h = harness();
  h.session.setContextDonor('donor_first'); h.session.setContextDonor('donor_current');
  await h.session.connect(); assert.equal(h.peer.channel.sent.length, 0);
  h.ready();
  const context = (event: Record<string, unknown>) => JSON.parse((event.item as { content: { text: string }[] }).content[0].text);
  assert.deepEqual(context(h.peer.channel.sent[0]), { ui_selected_donor: 'donor_current' });
  assert.equal(h.peer.channel.sent[1].type, 'response.create');
  const count = h.peer.channel.sent.length;
  h.session.setContextDonor('donor_current'); assert.equal(h.peer.channel.sent.length, count);
  h.session.setContextDonor('donor_next'); assert.deepEqual(context(h.peer.channel.sent.at(-1)!), { ui_selected_donor: 'donor_next' });
  h.session.setContextDonor(null); assert.deepEqual(context(h.peer.channel.sent.at(-1)!), { ui_selected_donor: null });
  const after = h.peer.channel.sent.length;
  h.session.setContextDonor('x'.repeat(201)); assert.equal(h.peer.channel.sent.length, after);
  assert.equal(h.peer.channel.sent.filter(event => event.type === 'response.create').length, 1);
  assert.equal(h.transcripts.length, 0);
  h.session.disconnect();
});

const approvalResult: CommandResult = {
  message: 'Review the proposed change.', mode: 'ai',
  approval: { id: 'PRIVATE_REVIEW', title: 'Combine?', description: 'Review', items: ['Rosa'], action: { type: 'merge', candidateIds: ['match1'] }, expiresAt: '2026-11-08' },
};
const proposalCall = (id: string) => ({ type: 'function_call', call_id: id, name: 'propose_change', arguments: JSON.stringify({ action: 'merge', candidateIds: ['match1'] }) });

test('one review card blocks further proposals until UI dismissal without blocking read tools', async () => {
  const h = harness({ fetch: async (url, init) => {
    if (!url.endsWith('/tool')) return new Response('answer');
    const body = JSON.parse(String(init?.body));
    return body.name === 'propose_change'
      ? Response.json({ result: approvalResult, output: { approval_required: true, changesMade: false } })
      : Response.json({ output: { donors: 300 } });
  } });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'batch' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'batch', status: 'completed', output: [proposalCall('p1'), proposalCall('p2'), toolCall('read')] } });
  await settle(); await settle();
  assert.equal(h.requests.filter(request => request.url.endsWith('/tool')).length, 2);
  assert.equal(h.results.filter(result => result.approval).length, 1);
  assert.equal(h.capture.track.enabled, false);
  const outputs = h.peer.channel.sent.filter(event => (event.item as { type?: string } | undefined)?.type === 'function_call_output');
  assert.equal(outputs.length, 3);
  assert.match((outputs[1].item as { output: string }).output, /already pending/);
  assert.equal(JSON.stringify(outputs).includes('PRIVATE_REVIEW'), false);
  h.session.setMuted(false); assert.equal(h.capture.track.enabled, false);
  h.session.setPaused(true); h.session.setPaused(false); assert.equal(h.capture.track.enabled, true);
  h.peer.channel.event({ type: 'response.created', response: { id: 'next' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'next', status: 'completed', output: [proposalCall('p3')] } });
  await settle(); await settle();
  assert.equal(h.results.filter(result => result.approval).length, 2);
  h.session.disconnect();
});

test('proposal reservation prevents concurrent response batches from opening two review cards', async () => {
  const first = deferred<Response>();
  const h = harness({ fetch: url => url.endsWith('/tool') ? first.promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'first' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'first', status: 'completed', output: [proposalCall('p1')] } });
  h.peer.channel.event({ type: 'response.created', response: { id: 'second' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'second', status: 'completed', output: [proposalCall('p2')] } });
  assert.equal(h.requests.filter(request => request.url.endsWith('/tool')).length, 1);
  first.resolve(Response.json({ result: approvalResult, output: { approval_required: true, changesMade: false } }));
  await settle(); await settle();
  assert.equal(h.results.length, 1); assert.equal(h.capture.track.enabled, false);
  assert.equal(h.peer.channel.sent.filter(event => event.type === 'response.create').length, 2);
  h.session.disconnect();
});

test('handshake shows bounded safe setup errors and hides credentials or oversized responses', async () => {
  const h = harness({ fetch: async () => Response.json({ error: 'Configure OPENAI_API_KEY to start live voice.' }, { status: 503 }) });
  await h.session.connect();
  assert.equal(h.errors[0], 'Configure OPENAI_API_KEY to start live voice.'); assert.equal(h.statuses.at(-1), 'idle');
  for (const error of ['Provider rejected sk-sensitive-do-not-display', 'x'.repeat(5000)]) {
    const invalid = harness({ fetch: async () => Response.json({ error }, { status: 503 }) });
    await invalid.session.connect();
    assert.equal(invalid.errors.length, 1); assert.ok(invalid.errors[0].length < 200);
    assert.equal(invalid.errors[0].includes('sk-sensitive'), false);
  }
});

test('a manual review opened during a proposal request cannot be replaced by its late result', async () => {
  const proposal = deferred<Response>();
  const h = harness({ fetch: url => url.endsWith('/tool') ? proposal.promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'proposal' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'proposal', status: 'completed', output: [proposalCall('p1')] } });
  assert.equal(h.requests.filter(request => request.url.endsWith('/tool')).length, 1);
  h.session.setPaused(true);
  proposal.resolve(Response.json({ result: approvalResult, output: { approval_required: true, changesMade: false } }));
  await settle(); await settle();
  assert.equal(h.results.length, 0); assert.equal(h.capture.track.enabled, false);
  const output = h.peer.channel.sent.find(event => (event.item as { type?: string } | undefined)?.type === 'function_call_output')!;
  const value = JSON.parse((output.item as { output: string }).output);
  assert.equal(value.proposalDisplayed, false); assert.match(value.message, /already pending/);
  assert.equal(JSON.stringify(h.peer.channel.sent).includes('PRIVATE_REVIEW'), false);
  h.session.setPaused(false); assert.equal(h.capture.track.enabled, true);
  h.session.disconnect();
});

test('completed responses keep their creation turn across newer speech and stale proposals never fetch', async () => {
  const h = harness({ fetch: async url => url.endsWith('/tool')
    ? Response.json({ result: { message: 'Old donor', donorId: 'old_donor', mode: 'ai' }, output: { donor: 'Old donor' } })
    : new Response('answer') });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'old-response' } });
  h.peer.channel.event({ type: 'input_audio_buffer.speech_started' });
  h.peer.channel.event({ type: 'input_audio_buffer.speech_stopped' });
  h.peer.channel.event({ type: 'response.created', response: { id: 'new-response' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'old-response', status: 'completed', output: [proposalCall('old-proposal'), toolCall('old-read')] } });
  await settle(); await settle();
  const tools = h.requests.filter(request => request.url.endsWith('/tool'));
  assert.equal(tools.length, 1); assert.equal(JSON.parse(String(tools[0].init?.body)).name, 'giftguard_request');
  assert.equal(h.results.length, 0);
  assert.equal(h.peer.channel.sent.filter(event => event.type === 'response.create').length, 1);
  const output = h.peer.channel.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === 'old-proposal')!;
  assert.match((output.item as { output: string }).output, /newer request/);
  h.session.disconnect();
});

test('unrecognized completed responses cannot execute tools without a response-created event', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.done', response: { id: 'unknown', status: 'completed', output: [proposalCall('unknown-proposal'), toolCall('unknown-read')] } });
  await settle();
  assert.equal(h.requests.filter(request => request.url.endsWith('/tool')).length, 0);
  assert.equal(h.results.length, 0);
  h.session.disconnect();
});

test('confirmed UI outcomes prompt a spoken acknowledgement without another mutation request', async () => {
  const h = harness(); await h.session.connect(); h.ready(); h.finishGreeting();
  const requestsBefore = h.requests.length;
  h.session.notifyAction('Records combined. Every gift was kept.');
  const event = h.peer.channel.sent.find(item => JSON.stringify(item).includes('ui_action_receipt'));
  assert.ok(event); assert.match(JSON.stringify(event), /Every gift was kept/);
  assert.equal(h.requests.length, requestsBefore);
  assert.equal(h.peer.channel.sent.at(-1)?.type, 'response.create');
  h.session.disconnect();
  const sent = h.peer.channel.sent.length;
  h.session.notifyAction('Should not be sent after ending.');
  assert.equal(h.peer.channel.sent.length, sent);
});

const visibleReadCall = (id: string, view = 'late') => ({ type: 'function_call', call_id: id, name: 'get_donor_context', arguments: JSON.stringify({ view }) });
const contextResult: CommandResult = { message: 'Follow-ups are ready.', mode: 'ai', view: 'calls' };
function finishToolResponse(h: ReturnType<typeof harness>, id: string, output: object[]) {
  h.peer.channel.event({ type: 'response.created', response: { id } });
  h.peer.channel.event({ type: 'response.done', response: { id, status: 'completed', output } });
}

test('activity starts before the actual tool fetch and completes only after accepted UI delivery', async () => {
  const response = deferred<Response>();
  const h = harness({ fetch: url => {
    if (!url.endsWith('/tool')) return Promise.resolve(new Response('answer'));
    assert.equal(h.activities.at(-1)?.phase, 'working');
    return response.promise;
  } });
  await h.session.connect(); h.ready(); h.finishGreeting();
  assert.equal(h.activities.length, 0);
  finishToolResponse(h, 'visible-read', [visibleReadCall('read-visible')]);
  assert.deepEqual(h.activities.map(activity => activity?.phase), ['working']);
  assert.deepEqual(h.activities[0]?.targets, ['nav-calls']);
  response.resolve(Response.json({ result: contextResult, output: { count: 3 } })); await settle(); await settle();
  assert.deepEqual(h.lifecycle, ['activity:working', 'result', 'activity:complete']);
  assert.deepEqual(h.activities.at(-1)?.targets, ['follow-up-list']);
  h.session.disconnect(); assert.equal(h.activities.at(-1), null);
});

test('failed real requests never produce completion and provider errors clear the visible activity', async () => {
  for (const reply of [() => new Response('unavailable', { status: 503 }), () => Response.json({ output: { error: 'No result' } })]) {
    const h = harness({ fetch: async url => url.endsWith('/tool') ? reply() : new Response('answer') });
    await h.session.connect(); h.ready(); h.finishGreeting();
    finishToolResponse(h, 'failure', [visibleReadCall('failed-read')]);
    await settle(); await settle();
    assert.deepEqual(h.activities.map(activity => activity?.phase), ['working', 'failed']);
    assert.equal(h.results.length, 0); assert.equal(h.errors.length, 1);
    h.peer.channel.event({ type: 'error' }); assert.equal(h.activities.at(-1), null);
  }
});

test('an expired sign-in is reported as such to the user and the model, without retrying or claiming success', async () => {
  const h = harness({ fetch: async url => url.endsWith('/tool') ? new Response(JSON.stringify({ error: 'Please sign in to GiftGuard.' }), { status: 401 }) : new Response('answer') });
  await h.session.connect(); h.ready(); h.finishGreeting();
  finishToolResponse(h, 'expired', [visibleReadCall('expired-read')]);
  await settle(); await settle();
  assert.equal(h.results.length, 0);
  assert.equal(h.errors.length, 1); assert.match(h.errors[0], /sign in again/i); assert.match(h.errors[0], /reconnect/i);
  assert.equal(h.requests.filter(request => request.url.endsWith('/tool')).length, 1);
  const output = h.peer.channel.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === 'expired-read')!;
  assert.match((output.item as { output: string }).output, /signed out/i);
  assert.doesNotMatch((output.item as { output: string }).output, /donor|result/i);
  assert.equal(h.activities.at(-1)?.phase, 'failed');
  h.session.disconnect();
});

test('interruption or ending clears working activity and late completion cannot restore it', async () => {
  for (const interruption of ['speech', 'disconnect']) {
    const response = deferred<Response>();
    const h = harness({ fetch: url => url.endsWith('/tool') ? response.promise : Promise.resolve(new Response('answer')) });
    await h.session.connect(); h.ready(); h.finishGreeting();
    finishToolResponse(h, 'pending', [visibleReadCall('pending-read')]);
    if (interruption === 'speech') h.peer.channel.event({ type: 'input_audio_buffer.speech_started' });
    else h.session.disconnect();
    assert.deepEqual(h.activities.map(activity => activity?.phase ?? 'clear'), ['working', 'clear']);
    response.resolve(Response.json({ result: contextResult, output: { count: 3 } })); await settle(); await settle();
    assert.deepEqual(h.activities.map(activity => activity?.phase ?? 'clear'), ['working', 'clear']);
    assert.equal(h.results.length, 0); h.session.disconnect();
  }
});

test('stale, blocked, unrecognized and cancelled tools never claim visual progress', async () => {
  const h = harness({ fetch: async url => url.endsWith('/tool') ? Response.json({ result: contextResult, output: { count: 3 } }) : new Response('answer') });
  await h.session.connect(); h.ready(); h.finishGreeting();
  h.peer.channel.event({ type: 'response.created', response: { id: 'stale' } });
  h.peer.channel.event({ type: 'input_audio_buffer.speech_started' });
  h.peer.channel.event({ type: 'response.done', response: { id: 'stale', status: 'completed', output: [visibleReadCall('old-read')] } });
  await settle(); await settle(); assert.equal(h.activities.length, 0);
  h.session.setPaused(true);
  finishToolResponse(h, 'blocked', [proposalCall('blocked-proposal')]);
  finishToolResponse(h, 'unrecognized', [toolCall('unrecognized')]);
  h.peer.channel.event({ type: 'response.created', response: { id: 'cancelled-visible' } });
  h.peer.channel.event({ type: 'response.done', response: { id: 'cancelled-visible', status: 'cancelled', output: [visibleReadCall('cancelled-read')] } });
  await settle(); await settle(); assert.equal(h.activities.length, 0);
  h.session.disconnect();
});

test('a proposal blocked after fetching clears its work without showing a review visual', async () => {
  const response = deferred<Response>();
  const h = harness({ fetch: url => url.endsWith('/tool') ? response.promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  finishToolResponse(h, 'proposal-activity', [proposalCall('proposal-visible')]);
  h.session.setPaused(true);
  response.resolve(Response.json({ result: approvalResult, output: { approval_required: true } })); await settle(); await settle();
  assert.deepEqual(h.activities.map(activity => activity?.phase ?? 'clear'), ['working', 'clear']);
  assert.equal(h.results.length, 0); h.session.disconnect();
});

test('review visuals clear on dismissal and saved visuals require an explicit server receipt', async () => {
  const h = harness({ fetch: async url => url.endsWith('/tool') ? Response.json({ result: approvalResult, output: { approval_required: true } }) : new Response('answer') });
  await h.session.connect(); h.ready(); h.finishGreeting();
  finishToolResponse(h, 'review-activity', [proposalCall('review-visible')]); await settle(); await settle();
  assert.deepEqual(h.activities.map(activity => activity?.phase), ['working', 'review']);
  assert.equal(h.activities.some(activity => activity?.phase === 'saved'), false);
  h.session.setPaused(false); assert.equal(h.activities.at(-1), null);
  h.session.notifyAction('Records combined. Every gift was kept.');
  assert.equal(h.activities.at(-1)?.phase, 'saved');
  assert.deepEqual(h.activities.at(-1)?.targets, ['workspace-notice']);
  h.session.setPaused(false); assert.equal(h.activities.at(-1)?.phase, 'saved');
  h.session.disconnect(); const count = h.activities.length;
  h.session.notifyAction('Not a live receipt.'); assert.equal(h.activities.length, count);
});

test('older completions cannot replace newer activity or a saved receipt', async () => {
  const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>()]; let index = 0;
  const h = harness({ fetch: url => url.endsWith('/tool') ? requests[index++].promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  finishToolResponse(h, 'old-activity', [visibleReadCall('old-visible')]);
  finishToolResponse(h, 'new-activity', [visibleReadCall('new-visible', 'matches')]);
  requests[0].resolve(Response.json({ result: contextResult, output: { count: 3 } })); await settle(); await settle();
  assert.equal(h.activities.length, 2); assert.match(h.activities.at(-1)!.id, /new-visible/); assert.equal(h.activities.at(-1)?.phase, 'working');
  requests[1].resolve(Response.json({ result: { ...contextResult, view: 'matches' }, output: { count: 2 } })); await settle(); await settle();
  assert.match(h.activities.at(-1)!.id, /new-visible/); assert.equal(h.activities.at(-1)?.phase, 'complete');
  finishToolResponse(h, 'another-activity', [visibleReadCall('another-visible')]);
  h.session.notifyAction('Your change was saved.'); const count = h.activities.length;
  requests[2].resolve(Response.json({ result: contextResult, output: { count: 3 } })); await settle(); await settle();
  assert.equal(h.activities.length, count); assert.equal(h.activities.at(-1)?.phase, 'saved');
  h.session.disconnect();
});

test('HTTP success without an accepted UI result never reports ready and preserves model output', async () => {
  for (const output of [{ error: 'The donor is unavailable.' }, { count: 3 }]) {
    const h = harness({ fetch: async url => url.endsWith('/tool') ? Response.json({ output }) : new Response('answer') });
    await h.session.connect(); h.ready(); h.finishGreeting();
    finishToolResponse(h, 'missing-result', [visibleReadCall('missing-result-call')]); await settle(); await settle();
    assert.deepEqual(h.activities.map(activity => activity?.phase), ['working', 'failed']);
    assert.equal(h.results.length, 0);
    const item = h.peer.channel.sent.find(event => (event.item as { call_id?: string } | undefined)?.call_id === 'missing-result-call')!;
    assert.deepEqual(JSON.parse((item.item as { output: string }).output), output);
    h.session.disconnect();
  }
});

test('a stale failed request cannot replace the new turn with an error or failed highlight', async () => {
  const response = deferred<Response>();
  const h = harness({ fetch: url => url.endsWith('/tool') ? response.promise : Promise.resolve(new Response('answer')) });
  await h.session.connect(); h.ready(); h.finishGreeting();
  finishToolResponse(h, 'soon-stale', [visibleReadCall('stale-failure')]);
  h.peer.channel.event({ type: 'input_audio_buffer.speech_started' });
  response.resolve(new Response('Unavailable', { status: 503 })); await settle(); await settle();
  assert.deepEqual(h.activities.map(activity => activity?.phase ?? 'clear'), ['working', 'clear']);
  assert.equal(h.errors.length, 0); h.session.disconnect();
});

test('activity identities remain unique when a user ends and starts a new voice session', async () => {
  const first = harness(); await first.session.connect(); first.ready(); first.finishGreeting();
  first.session.notifyAction('Saved.'); const firstId = first.activities.at(-1)?.id;
  first.session.disconnect();
  const second = harness(); await second.session.connect(); second.ready(); second.finishGreeting();
  second.session.notifyAction('Saved.'); const secondId = second.activities.at(-1)?.id;
  assert.ok(firstId); assert.ok(secondId); assert.notEqual(firstId, secondId);
  second.session.disconnect();
});
