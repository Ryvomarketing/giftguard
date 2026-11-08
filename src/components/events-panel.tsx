'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Copy, ExternalLink, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SignupForm } from '@/components/signup-form';
import type { SignupEvent } from '@/lib/types';

type Props = {
  events: SignupEvent[]; today: string; selectedId: string | null; busy: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (input: { name: string; host: string; date: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Staff view of sign-up lists: create one, share it, see who signed up, and see exactly what a guest sees. */
export function EventsPanel({ events, today, selectedId, busy, onSelect, onCreate, onRemove }: Props) {
  const [creating, setCreating] = useState(events.length === 0);
  const [draft, setDraft] = useState({ name: '', host: '', date: '' });
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => '');
  // Reset per-selection UI state when the selected list changes, whether by click or by the assistant.
  const [resetFor, setResetFor] = useState(selectedId);
  if (resetFor !== selectedId) { setResetFor(selectedId); setConfirmRemove(false); setCopied(false); }
  const selected = events.find(event => event.id === selectedId) ?? null;
  // Bring the selected list into view, whether it was chosen by a click or opened by the assistant.
  const detailRef = useRef<HTMLElement>(null);
  const selectedKey = selected?.id ?? null;
  useEffect(() => { if (selectedKey) detailRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }, [selectedKey]);
  const link = selected ? `${origin}/signup/${selected.code}` : '';

  async function create(e: React.FormEvent) {
    e.preventDefault(); setFormError('');
    if (draft.name.trim().length < 2) { setFormError('Give the event a name.'); return; }
    if (!draft.date) { setFormError('Choose the event date.'); return; }
    try { await onCreate({ name: draft.name.trim(), host: draft.host.trim(), date: draft.date }); setDraft({ name: '', host: '', date: '' }); setCreating(false); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'The list could not be created.'); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked; the link is visible to select */ }
  }

  return (
    <div className="events-panel">
      <div className="events-toolbar">
        <span className="events-count"><Users size={14} aria-hidden="true" />{events.length} {events.length === 1 ? 'list' : 'lists'} · {events.reduce((sum, event) => sum + event.signups.length, 0)} guests</span>
        <Button variant={creating ? 'outline' : 'default'} size="sm" onClick={() => setCreating(value => !value)} disabled={busy}><Plus size={14} />{creating ? 'Cancel' : 'New sign-up list'}</Button>
      </div>
      {creating && <form className="event-create" onSubmit={create} aria-label="Create a sign-up list">
        <label>Event name<Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Miami Foundation Gala" required /></label>
        <label>Host (optional)<Input value={draft.host} onChange={e => setDraft(d => ({ ...d, host: e.target.value }))} placeholder="Miami Foundation" /></label>
        <label>Date<Input type="date" value={draft.date} min={today} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} required /></label>
        <Button type="submit" disabled={busy}>Create list</Button>
        {formError && <p className="inline-error" role="alert">{formError}</p>}
      </form>}

      <div className="event-list" data-agent-target="event-list" aria-label="Sign-up lists">
        {events.length === 0 && !creating && <p className="secondary-note">No sign-up lists yet. Create one here, or ask the assistant: “Make me a sign-up list for the gala on November 21.”</p>}
        {events.map(event => {
          const existing = event.signups.filter(signup => signup.matchDonorId).length;
          const pledged = event.signups.reduce((sum, signup) => sum + (signup.pledgeCents ?? 0), 0);
          const upcoming = event.date >= today;
          return <button type="button" key={event.id} className={`event-card ${event.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(event.id === selectedId ? null : event.id)} aria-current={event.id === selectedId ? 'true' : undefined}>
            <span className="event-when"><strong>{new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })}</strong><small>{new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</small></span>
            <span className="event-main"><strong>{event.name}</strong><small>{event.host ? `${event.host} · ` : ''}{longDate(event.date)}{upcoming ? '' : ' · past'}{event.createdBy === 'assistant' ? ' · created by the assistant' : ''}</small></span>
            <span className="event-stats"><strong>{event.signups.length}</strong><small>{event.signups.length === 1 ? 'guest' : 'guests'}</small>{existing > 0 && <em>{existing} already donors</em>}{pledged > 0 && <em>{money(pledged)} pledged</em>}</span>
          </button>;
        })}
      </div>

      {selected && <section ref={detailRef} className="event-detail" data-agent-target="event-detail" aria-label={`${selected.name} sign-up list`}>
        <div className="event-detail-main">
          <div className="event-share">
            <div className="event-share-text">
              <h2>{selected.name}</h2>
              <p>{longDate(selected.date)}{selected.host ? ` · Hosted by ${selected.host}` : ''}</p>
              <label className="event-link">Guest sign-up link<div><Input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Guest sign-up link" /><Button variant="outline" size="sm" onClick={() => void copyLink()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</Button><Button variant="ghost" size="sm" asChild><a href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open</a></Button></div></label>
              <p className="secondary-note">Put the QR code on the check-in table or a slide. Guests see only the form; the donor matches below stay with staff.</p>
            </div>
            {/* The QR image is rendered by this app's own server for this link; nothing leaves the workspace. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="event-qr" src={`/api/events?qr=${encodeURIComponent(selected.code)}`} alt={`QR code for the ${selected.name} sign-up page`} width={160} height={160} />
          </div>

          <h3 className="event-guests-heading">Guests <span>{selected.signups.length}</span></h3>
          {selected.signups.length ? <div className="guest-table">
            <div className="guest-heading"><span>Guest</span><span>Contact</span><span>Pledge</span><span>Already a donor?</span></div>
            {selected.signups.map(signup => <div className="guest-row" key={signup.id}>
              <span><strong>{signup.name}</strong><small>{shortTime(signup.createdAt)}{signup.language === 'es' ? ' · Español' : ''}</small></span>
              <span><small>{signup.email || signup.phone || 'No contact left'}</small>{signup.email && signup.phone && <small>{signup.phone}</small>}{signup.zip && <small>ZIP {signup.zip}</small>}</span>
              <span>{signup.pledgeCents ? money(signup.pledgeCents) : <small>—</small>}</span>
              <span>{signup.matchDonorId ? <Badge variant="secondary" title={`${signup.matchReason} · ${signup.matchConfidence} confidence`}>Likely {signup.matchName}</Badge> : <Badge variant="outline">New</Badge>}{signup.matchReason && <small>{signup.matchReason} · {signup.matchConfidence}</small>}</span>
            </div>)}
          </div> : <p className="secondary-note">No one has signed up yet. Open the guest page on a tablet at the door, or share the link.</p>}

          {selected.signups.length === 0 && <div className="event-remove">{confirmRemove
            ? <><span className="secondary-note">Remove this empty list?</span><Button variant="outline" size="sm" disabled={busy} onClick={() => void onRemove(selected.id)}>Yes, remove</Button><Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>Keep it</Button></>
            : <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}><Trash2 size={14} />Remove this list</Button>}</div>}
        </div>

        <aside className="event-preview" data-agent-target="event-preview" aria-label="What a guest sees">
          <p className="event-preview-label">What a guest sees</p>
          <div className="phone-frame"><div className="phone-screen"><SignupForm event={{ code: selected.code, name: selected.name, host: selected.host, date: selected.date }} preview /></div></div>
        </aside>
      </section>}
    </div>
  );
}
