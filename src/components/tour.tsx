'use client';

import { useEffect, useRef, useState } from 'react';
import { Square, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AgentActivity } from '@/lib/agent-activity';
import type { TourLanguage, TourStep } from '@/lib/showcase';

type View = TourStep['view'];
type Props = { steps: TourStep[]; language?: TourLanguage; onNavigate: (view: View) => void; onActivity: (activity: AgentActivity | null) => void; onEnd: () => void };
type Narration = 'audio' | 'browser' | 'captions';

const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

async function fetchNarration(text: string, signal: AbortSignal, attempt = 0): Promise<string | null> {
  try {
    const response = await fetch('/api/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal });
    if (response.ok) return URL.createObjectURL(await response.blob());
    // One quiet retry covers a momentary limit or hiccup; a real outage falls back to captions.
    if (attempt === 0 && response.status !== 503 && !signal.aborted) { await wait(900, signal); return fetchNarration(text, signal, 1); }
    return null;
  } catch { return null; }
}

function playUrl(url: string, signal: AbortSignal, hold: { current: HTMLAudioElement | null }): Promise<boolean> {
  return new Promise(resolve => {
    const audio = new Audio(url);
    hold.current = audio;
    const done = (ok: boolean) => { hold.current = null; URL.revokeObjectURL(url); resolve(ok); };
    audio.onended = () => done(true);
    audio.onerror = () => done(false);
    signal.addEventListener('abort', () => { audio.pause(); done(true); }, { once: true });
    audio.play().catch(() => done(false));
  });
}

function speakInBrowser(text: string, language: TourLanguage, signal: AbortSignal): Promise<boolean> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve(false);
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1; utterance.lang = language === 'es' ? 'es-US' : 'en-US';
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    signal.addEventListener('abort', () => { window.speechSynthesis.cancel(); resolve(true); }, { once: true });
    window.speechSynthesis.speak(utterance);
  });
}

/** Walks the pages while narrating. It only navigates and points; it never saves, merges, sends or approves anything. */
export function Tour({ steps, language = 'en', onNavigate, onActivity, onEnd }: Props) {
  const [index, setIndex] = useState(0);
  const [narration, setNarration] = useState<Narration>('audio');
  const audio = useRef<HTMLAudioElement | null>(null);
  const callbacks = useRef({ onNavigate, onActivity, onEnd });
  useEffect(() => { callbacks.current = { onNavigate, onActivity, onEnd }; });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // The first clip is fetched now; each next clip is fetched while the current one plays, so there is no burst and no gap.
    const clips: Promise<string | null>[] = [fetchNarration(steps[0].say, signal)];
    const run = async () => {
      for (let position = 0; position < steps.length && !signal.aborted; position++) {
        const step = steps[position];
        setIndex(position);
        callbacks.current.onActivity({ id: step.id, phase: 'working', label: step.label, targets: [`nav-${step.view === 'home' ? 'home' : step.view}`] });
        callbacks.current.onNavigate(step.view);
        await wait(650, signal);
        if (signal.aborted) break;
        callbacks.current.onActivity({ id: step.id, phase: 'working', label: step.label, targets: step.targets });
        if (position + 1 < steps.length) clips[position + 1] = fetchNarration(steps[position + 1].say, signal);
        const url = await clips[position];
        let spoken = false;
        if (url) { setNarration('audio'); spoken = await playUrl(url, signal, audio); }
        if (!spoken && !signal.aborted) { const browser = await speakInBrowser(step.say, language, signal); setNarration(browser ? 'browser' : 'captions'); spoken = browser; }
        if (!spoken && !signal.aborted) await wait(Math.max(2600, step.say.split(/\s+/).length * 360), signal);
        if (signal.aborted) break;
        callbacks.current.onActivity({ id: step.id, phase: 'complete', label: step.label, targets: step.targets });
        await wait(position === steps.length - 1 ? 1200 : 500, signal);
      }
      if (!signal.aborted) callbacks.current.onEnd();
    };
    void run();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') callbacks.current.onEnd(); };
    window.addEventListener('keydown', onKey);
    const playing = audio;
    return () => {
      controller.abort();
      window.removeEventListener('keydown', onKey);
      playing.current?.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      void Promise.all(clips).then(urls => urls.forEach(url => { if (url) URL.revokeObjectURL(url); }));
    };
  }, [steps, language]);

  const step = steps[index];
  if (!step) return null;
  return (
    <aside className="tour-caption" role="status" aria-live="polite" aria-atomic="true" data-agent-target="tour-caption">
      <div className="tour-caption-head">
        <span className="tour-caption-label">{narration === 'captions' ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}{language === 'es' ? 'Recorrido GiftGuard' : 'GiftGuard tour'} · {index + 1} {language === 'es' ? 'de' : 'of'} {steps.length}</span>
        <Button variant="ghost" size="sm" className="tour-stop" onClick={onEnd} aria-label={language === 'es' ? 'Detener el recorrido' : 'Stop the tour'}><Square size={12} />{language === 'es' ? 'Detener' : 'Stop'}</Button>
      </div>
      <p lang={language}>{step.say}</p>
      {narration !== 'audio' && <small>{language === 'es'
        ? narration === 'browser' ? 'Voz del navegador; la narración del servidor no está disponible.' : 'La narración no está disponible; el recorrido se muestra como subtítulos.'
        : narration === 'browser' ? 'Spoken by your browser; server narration is unavailable.' : 'Narration is unavailable, so the tour reads as captions.'}</small>}
    </aside>
  );
}
