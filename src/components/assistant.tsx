'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ArrowUp, ChevronDown, Eye, EyeOff, Keyboard, Loader2, Mic, MicOff, PhoneOff, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { LiveVoiceSession } from '@/lib/realtime-client';
import type { AgentActivity } from '@/lib/agent-activity';
import type { CommandResult } from '@/lib/types';

type Status = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'paused';
type Message = { role: 'user' | 'assistant'; content: string; sample?: boolean; note?: string };
type Transcript = { id: string; role: 'user' | 'assistant'; text: string };
export type VoiceControls = { end(): void; notifySaved(message: string): void };
type Props = { onActivity?: (activity: AgentActivity | null) => void; showActivity?: boolean; onShowActivityChange?: (show: boolean) => void; voiceControlRef?: Ref<VoiceControls>; onLiveChange?: (active: boolean) => void; onResult: (result: CommandResult) => void; aiAvailable: boolean; suspended?: boolean; approvalPending?: boolean; contextDonorId?: string | null };
const statusLabel: Record<Status, string> = { idle: 'Ready to talk', connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking…', speaking: 'Speaking', paused: 'Microphone paused' };

export function Assistant({ onResult, aiAvailable, suspended = false, approvalPending = false, contextDonorId, voiceControlRef, onLiveChange, onActivity, showActivity = true, onShowActivityChange }: Props) {
  const [open, setOpen] = useState(false);
  // Minimized keeps the live conversation running while only the floating pill stays on screen.
  const [minimized, setMinimized] = useState(false);
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [status, setStatus] = useState<Status>('idle');
  const [muted, setMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<{ label: string; text: string } | null>(null);
  const [liveDraft, setLiveDraft] = useState<{ text: string; sample: boolean } | null>(null);
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null);
  async function copyMessageDraft(index: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopiedMessage(index); }
    catch { setError('Select the draft and copy it with your keyboard.'); }
  }
  const session = useRef<LiveVoiceSession | null>(null);
  const onResultRef = useRef(onResult);
  const onLiveChangeRef = useRef(onLiveChange);
  const onActivityRef = useRef(onActivity);
  const donorContextRef = useRef(contextDonorId);
  const approvalRef = useRef(approvalPending);
  const lastDonor = useRef<string | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const textRequest = useRef<AbortController | null>(null);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);
  useEffect(() => { onLiveChangeRef.current = onLiveChange; }, [onLiveChange]);
  useEffect(() => { donorContextRef.current = contextDonorId; session.current?.setContextDonor(contextDonorId || null); }, [contextDonorId]);
  useEffect(() => { approvalRef.current = approvalPending; session.current?.setPaused(approvalPending); }, [approvalPending]);
  useEffect(() => () => { session.current?.disconnect(); textRequest.current?.abort(); }, []);

  const endVoice = useCallback(() => {
    session.current?.disconnect(); session.current = null;
    onActivityRef.current?.(null);
    setStatus('idle'); setMuted(false); setAudioBlocked(false); setMinimized(false);
  }, []);
  useImperativeHandle(voiceControlRef, () => ({ end: endVoice, notifySaved: message => { setActivity({ label: 'Saved', text: message }); session.current?.notifyAction(message); } }), [endVoice]);
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) { endVoice(); textRequest.current?.abort(); setBusy(false); }
  }

  async function startVoice() {
    if (session.current || approvalPending) return;
    setOpen(true); setMinimized(false); setMode('voice'); setError(''); setTranscript([]); setLiveDraft(null); setActivity(null); setAudioBlocked(false); setMuted(false);
    textRequest.current?.abort(); setBusy(false);
    const call = new LiveVoiceSession({
      onActivity: value => onActivityRef.current?.(value),
      onStatus: next => { setStatus(next); onLiveChangeRef.current?.(next !== 'idle'); if (next === 'idle') session.current = null; },
      onTranscript: entry => setTranscript(previous => {
        const existing = previous.findIndex(item => item.id === entry.id && item.role === entry.role);
        if (existing < 0) return [...previous, entry].slice(-40);
        return previous.map((item, index) => index === existing ? entry : item);
      }),
      onResult: result => { setActivity({ label: result.approval ? 'Review needed' : result.note ? 'Draft ready' : 'On screen', text: result.message }); if (result.note) { setLiveDraft({ text: result.note, sample: result.mode === 'demo' }); setMinimized(false); } if (result.donorId) lastDonor.current = result.donorId; onResultRef.current(result); },
      onError: message => setError(message),
      onAudioBlocked: () => setAudioBlocked(true),
    });
    session.current = call;
    call.setContextDonor(donorContextRef.current || null);
    await call.connect();
    if (session.current === call) call.setPaused(approvalRef.current);
  }

  function openText() {
    endVoice(); setMode('text'); setOpen(true); setMinimized(false); setError('');
  }
  function toggleMic() {
    const next = !muted; setMuted(next); session.current?.setMuted(next);
  }
  async function sendText() {
    const text = input.trim(); if (!text || busy) return;
    const controller = new AbortController(); textRequest.current = controller;
    setBusy(true); setError(''); setInput('');
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 900) }));
    setMessages(previous => [...previous, { role: 'user', content: text }]);
    try {
      const response = await fetch('/api/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, history, contextDonorId: contextDonorId || lastDonor.current || undefined }), signal: controller.signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Please try again.');
      if (controller.signal.aborted) return;
      const answer = result as CommandResult;
      setMessages(previous => [...previous, { role: 'assistant', content: answer.message, note: answer.note, sample: answer.mode === 'demo' }]);
      if (answer.donorId) lastDonor.current = answer.donorId;
      onResultRef.current(answer);
    } catch (err) { if (!controller.signal.aborted) { setError((err as Error).message); setInput(text); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  const connected = status !== 'idle' && status !== 'connecting';
  const active = status !== 'idle';
  const hidden = !open || suspended || minimized;
  return <Dialog open={open && !suspended && !minimized} onOpenChange={changeOpen} modal={false}>
    {hidden && <div className="fixed right-5 bottom-5 z-[60] flex items-center overflow-hidden rounded-full bg-black text-white shadow-lg sm:right-8 sm:bottom-8">
      {active && minimized && !suspended ? <>
        <Button ref={launcher} className="h-12 gap-2 rounded-none bg-black px-4 text-white hover:bg-neutral-800" onClick={() => setMinimized(false)} aria-label="Open the live voice panel">{status === 'thinking' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none"/> : muted ? <MicOff className="size-4"/> : <Mic className={`size-4 ${status === 'speaking' ? 'animate-pulse motion-reduce:animate-none' : ''}`}/>}{muted ? 'Muted' : statusLabel[status]}</Button>
        <span aria-hidden="true" className="h-6 w-px bg-white/25"/>
        <Button size="icon" className="size-12 rounded-none bg-black text-white hover:bg-neutral-800" onClick={() => { endVoice(); setOpen(false); }} aria-label="End live voice conversation"><PhoneOff className="size-4"/></Button>
      </> : active ? <Button ref={launcher} className="h-12 gap-2 rounded-none bg-black px-5 text-white hover:bg-neutral-800" onClick={() => { endVoice(); setOpen(false); }} aria-label="End live voice conversation"><PhoneOff className="size-4"/>{approvalPending ? 'Voice paused · End' : 'Live voice · End'}</Button> : <>
        <Button ref={launcher} data-agent-target="voice-launcher" className="h-12 gap-2 rounded-none bg-black px-5 text-white hover:bg-neutral-800" onClick={() => void startVoice()} disabled={suspended} aria-label="Start live voice conversation"><Mic className="size-4" strokeWidth={1.5}/>Talk to GiftGuard</Button>
        <span aria-hidden="true" className="h-6 w-px bg-white/25"/>
        <Button size="icon" className="size-12 rounded-none bg-black text-white hover:bg-neutral-800" onClick={openText} disabled={suspended} aria-label="Type to GiftGuard"><Keyboard className="size-4" strokeWidth={1.5}/></Button>
      </>}
    </div>}
    <DialogContent data-agent-target="voice-panel" showCloseButton={false} className="fixed inset-x-3 top-auto bottom-3 z-50 flex max-h-[min(520px,calc(100dvh-24px))] w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-y-auto rounded-2xl border-neutral-200 bg-white p-0 shadow-2xl sm:inset-x-auto sm:right-8 sm:bottom-8 sm:w-[340px] sm:max-w-[340px]" onOpenAutoFocus={event => { if (mode === 'text') { event.preventDefault(); textInput.current?.focus(); } }} onCloseAutoFocus={event => { if (!suspended) { event.preventDefault(); launcher.current?.focus(); } }} onInteractOutside={event => event.preventDefault()}>
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-2.5">
        <div><DialogTitle className="text-sm font-medium tracking-tight">GiftGuard</DialogTitle><DialogDescription className="text-xs text-neutral-500">{mode === 'voice' ? 'Live voice' : aiAvailable ? 'Your donor assistant' : 'Sample text assistant'}</DialogDescription></div>
        <div className="flex items-center gap-1">
          {mode === 'voice' && active && <Button variant="ghost" size="icon-sm" aria-label="Minimize the voice panel and keep talking" onClick={() => setMinimized(true)}><ChevronDown className="size-4"/></Button>}
          <Button variant="ghost" size="icon-sm" aria-label="Close assistant and end voice" onClick={() => changeOpen(false)}><X className="size-4"/></Button>
        </div>
      </header>
      {mode === 'voice' ? <div className="px-4 py-3">
        <div className="flex items-center gap-3" aria-live="polite">
          <span aria-hidden="true" className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white ${status === 'speaking' ? 'animate-pulse motion-reduce:animate-none' : ''}`}>{status === 'connecting' || status === 'thinking' ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none"/> : muted || approvalPending ? <MicOff className="size-4" strokeWidth={1.5}/> : <Mic className="size-4" strokeWidth={1.5}/>}</span>
          <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-tight">{muted && connected ? 'Microphone muted' : statusLabel[status]}</p><p className="truncate text-xs text-neutral-500">{connected ? 'Speak naturally. You can interrupt.' : status === 'connecting' ? 'Allow microphone access to connect.' : 'Connect to talk back and forth.'}</p></div>
          {active ? <>
            <Button variant="outline" size="icon-sm" disabled={!connected || approvalPending} onClick={toggleMic} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted}>{muted ? <MicOff className="size-4"/> : <Mic className="size-4"/>}</Button>
            <Button size="icon-sm" onClick={endVoice} aria-label="End conversation"><PhoneOff className="size-4"/></Button>
          </> : <Button size="sm" onClick={() => void startVoice()} className="gap-2"><Mic className="size-4"/>Connect</Button>}
        </div>
        {error && <p role="alert" className="mt-3 border-l-2 border-black pl-3 text-sm leading-relaxed text-neutral-700">{error}</p>}
        {audioBlocked && <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => { void session.current?.resumeAudio().then(playing => { if (playing) setAudioBlocked(false); }); }}><Volume2 className="size-4"/>Enable audio</Button>}
        {activity && <div className="mt-3 rounded-lg border border-neutral-200 px-3 py-2" role="status"><p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{activity.label}</p><p className="mt-0.5 text-sm leading-snug">{activity.text}</p></div>}
        {liveDraft && <details data-agent-target="voice-draft" open className="mt-3 border-t border-neutral-200 pt-2"><summary className="text-xs text-neutral-600">{liveDraft.sample ? 'Template draft' : 'AI draft'} · edit and copy, nothing is sent</summary><Textarea value={liveDraft.text} onChange={event => setLiveDraft(current => current ? { ...current, text: event.target.value } : current)} aria-label="Draft from voice conversation" className="mt-2 min-h-28 text-sm"/><Button variant="outline" size="sm" className="mt-2" onClick={async () => { try { await navigator.clipboard.writeText(liveDraft.text); setActivity({ label: 'Copied', text: 'The draft is on your clipboard, ready to paste into your email or text.' }); } catch { setError('Select the note and copy it with your keyboard.'); } }}>Copy draft</Button></details>}
        {transcript.length > 0 && <details className="mt-3 border-t border-neutral-200 pt-2"><summary className="text-xs text-neutral-500">Conversation</summary><div className="mt-2 max-h-40 space-y-2 overflow-y-auto" role="log" aria-label="Live assistant replies">{transcript.map(entry => <div key={`${entry.role}-${entry.id}`}><span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{entry.role === 'user' ? 'You' : 'GiftGuard'}</span><p className="whitespace-pre-wrap text-sm leading-snug">{entry.text}</p></div>)}</div></details>}
        <div className="mt-2 flex items-center justify-between"><span className="text-[11px] text-neutral-400">AI voice · mic on while connected</span><div className="flex items-center gap-1"><Button variant="link" size="sm" className="h-7 px-1 text-xs text-neutral-500" onClick={openText}>Type instead</Button><Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-neutral-600" aria-label="Show agent activity on the workspace" aria-pressed={showActivity} onClick={() => onShowActivityChange?.(!showActivity)}>{showActivity ? <Eye className="size-3.5"/> : <EyeOff className="size-3.5"/>}Activity</Button></div></div>
      </div> : <div className="flex min-h-0 flex-col">
        <div className="max-h-80 min-h-32 space-y-4 overflow-y-auto px-5 py-5" role="log" aria-live="polite" aria-label="Text conversation">{messages.length ? messages.map((message,index) => <div key={index} className={message.role === 'user' ? 'ml-8 rounded-xl bg-neutral-100 px-4 py-3' : ''}><span className="text-[10px] uppercase tracking-wider text-neutral-500">{message.role === 'user' ? 'You' : message.sample ? 'GiftGuard · sample' : 'GiftGuard'}</span><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          {message.note !== undefined && <div className="mt-3" data-agent-target="text-draft"><Textarea value={message.note} onChange={event => { const text = event.target.value; setMessages(previous => previous.map((item, position) => position === index ? { ...item, note: text } : item)); setCopiedMessage(current => current === index ? null : current); }} aria-label="Editable draft from the assistant" className="min-h-36 text-sm"/><div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-neutral-500">{message.sample ? 'Template draft' : 'AI draft'} · nothing is sent</span><Button type="button" variant="outline" size="sm" onClick={() => void copyMessageDraft(index, message.note ?? '')}>{copiedMessage === index ? 'Copied' : 'Copy draft'}</Button></div></div>}
        </div>) : <p className="text-sm text-neutral-600">Ask about donors, duplicates, or follow-ups. You can also ask me to write a note, email or text for a donor.</p>}{busy && <p className="text-sm text-neutral-500">Thinking…</p>}</div>
        <form className="border-t border-neutral-200 p-4" onSubmit={event => { event.preventDefault(); void sendText(); }}>{error && <p role="alert" className="mb-3 text-sm">{error}</p>}<Textarea ref={textInput} rows={2} maxLength={1000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendText(); } }} placeholder="Ask GiftGuard… (Enter to send, Shift+Enter for a new line)" aria-label="Message GiftGuard" disabled={busy} className="resize-none"/><div className="mt-2 flex justify-between"><Button type="button" variant="ghost" size="sm" onClick={() => void startVoice()} disabled={busy}><Mic className="size-4"/>Switch to live voice</Button><Button type="submit" size="icon" disabled={!input.trim() || busy} aria-label="Send message"><ArrowUp className="size-4"/></Button></div></form>
      </div>}
    </DialogContent>
  </Dialog>;
}
