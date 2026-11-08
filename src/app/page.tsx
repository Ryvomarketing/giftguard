'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Copy, Loader2, Table2, Upload, Undo2, X } from 'lucide-react';
import { Assistant, type VoiceControls } from '@/components/assistant';
import { AgentSpotlight } from '@/components/agent-spotlight';
import type { AgentActivity } from '@/lib/agent-activity';
import { HelpTip } from '@/components/help-tip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Action, Approval, CommandResult, ContactStatus, ImportResult, LateFlag, Snapshot, Source, UploadedFile } from '@/lib/types';
import { needsOutreach } from '@/lib/outreach';
import { buildJourney } from '@/lib/journey';
import type { DraftFormat } from '@/lib/agents';

type View = 'home' | 'matches' | 'calls' | 'donors';
const sources: Record<Source, string> = { online: 'Online donations', event: 'Event tickets', auction: 'Gala auction', check: 'Mailed checks' };
const sampleFiles: Record<Source, string> = { online: 'online-donations', event: 'event-tickets', auction: 'gala-auction', check: 'mailed-checks' };
const navigation: { id: View; label: string }[] = [{ id: 'home', label: 'Start' }, { id: 'matches', label: 'Duplicates' }, { id: 'calls', label: 'Calls this week' }, { id: 'donors', label: 'All donors' }];
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const date = (value: string) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded';

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (response.status === 401) window.dispatchEvent(new CustomEvent('giftguard:signed-out'));
  if (!response.ok) throw new Error(result.error || (response.status === 401 ? 'Your sign-in expired. Please sign in again.' : 'Something went wrong. Please try again.'));
  return result as T;
}

export default function Home() {
  const voiceControls = useRef<VoiceControls | null>(null);
  const [liveVoiceActive, setLiveVoiceActive] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [showAgentActivity, setShowAgentActivity] = useState(true);
  const [data, setData] = useState<Snapshot | null>(null);
  const [view, setView] = useState<View>('home');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [approval, setApproval] = useState<Approval | null>(null);
  const [selectedDonor, setSelectedDonor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importReport, setImportReport] = useState<ImportResult | null>(null);
  const uploadFilesRef = useRef<File[]>([]);
  const [columnChoices, setColumnChoices] = useState<Record<string, Record<string, string>>>({});
  const [sourceChoices, setSourceChoices] = useState<Record<string, Source>>({});
  const [donorFilter, setDonorFilter] = useState<string[] | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [deferredThisVisit, setDeferredThisVisit] = useState<string[]>([]);
  const [mergeProof, setMergeProof] = useState<{ donorId: string; name: string; transactions: number } | null>(null);
  const [reviewEmail, setReviewEmail] = useState('');
  const [reviewAddress, setReviewAddress] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [activeCall, setActiveCall] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftModes, setDraftModes] = useState<Record<string, string>>({});
  const [noteBusy, setNoteBusy] = useState(false);
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, 'en' | 'es'>>({});
  const [giveMiami, setGiveMiami] = useState(false);
  const [formatChoices, setFormatChoices] = useState<Record<string, DraftFormat>>({});
  const [outreachInput, setOutreachInput] = useState<{ donorId: string; status: ContactStatus | ''; result: string } | null>(null);
  const [undoAction, setUndoAction] = useState<Action | null>(null);
  const [fileView, setFileView] = useState<{ source: Source; file: UploadedFile | null; files: { file: string; rows: number; importedAt: string }[]; loading: boolean; error: string } | null>(null);
  const [fileQuery, setFileQuery] = useState('');
  const [editContact, setEditContact] = useState(false);
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const approvalReturnFocus = useRef<HTMLElement | null>(null);
  const donorReturnFocus = useRef<HTMLElement | null>(null);
  function restoreDialogFocus(event: Event, target: HTMLElement | null) {
    event.preventDefault();
    const fallback = document.querySelector<HTMLElement>('nav [aria-current=page]');
    (target?.isConnected ? target : fallback)?.focus();
  }

  const refresh = useCallback(async () => {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.status === 401) { setNeedsLogin(true); return; }
    const state = await response.json();
    if (!response.ok) throw new Error(state.error || 'We could not load your workspace.');
    setData(state); setNeedsLogin(false);
    setSelectedDonor(current => current && (state as Snapshot).donors.some(donor => donor.id === current) ? current : null);
    return state as Snapshot;
  }, []);
  // Initial data comes from the server; this effect starts that asynchronous load.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  // Any 401 (for example after a server restart) returns to the sign-in screen, which also ends live voice.
  useEffect(() => {
    const signedOut = () => { setNeedsLogin(true); setApproval(null); setError('Your sign-in expired, usually because the server restarted. Sign in again to continue.'); };
    window.addEventListener('giftguard:signed-out', signedOut); return () => window.removeEventListener('giftguard:signed-out', signedOut);
  }, []);
  const pending = data?.matches.filter(match => match.status === 'pending') || [];
  const reviewQueue = data?.matches.filter(item => item.status === 'pending' || (showLater && item.status === 'skipped' && !deferredThisVisit.includes(item.id))) || [];
  const match = reviewQueue[0];
  const matchRecords = data?.donors.flatMap(d => d.records).filter(record => match?.recordIds.includes(record.id)) || [];
  const matchGifts = data?.donors.flatMap(d => d.gifts).filter(gift => match?.recordIds.includes(gift.recordId)) || [];
  const donor = data?.donors.find(d => d.id === selectedDonor);
  const openFlags = data?.flags.filter(flag => needsOutreach(flag, data.outreach, data.today)) || [];
  const flags = (showDone ? data?.flags || [] : openFlags).filter(f => f.name.toLowerCase().includes(query.toLowerCase()));
  const call = flags.find(f => f.donorId === activeCall) || flags[0];
  const callDonor = data?.donors.find(d => d.id === call?.donorId);
  const language = (call && languageOverrides[call.donorId]) || callDonor?.language || 'en';
  const currentOutreach = outreachInput?.donorId === call?.donorId ? outreachInput : null;
  const contactStatus = currentOutreach?.status || '';
  const resultNote = currentOutreach?.result || '';

  const closeDonor = useCallback(() => { setSelectedDonor(null); setEditContact(false); }, []);
  const propose = useCallback(async (action: Action) => {
    setBusy(true); setError('');
    try { const proposal = await request<Approval>('/api/propose', { action }); setApproval(current => current ?? proposal); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (!match || view !== 'matches') return;
    const handle = (event: KeyboardEvent) => {
      if (approval || selectedDonor || busy || event.metaKey || event.ctrlKey || event.altKey || !document.querySelector('.review-zone')?.contains(document.activeElement)) return;
      if (/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return;
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); void propose({ type: 'merge', candidateIds: [match.id], ...(reviewEmail ? { email: reviewEmail } : {}), ...(reviewAddress ? { address: reviewAddress } : {}) }); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void propose({ type: 'reject', candidateId: match.id }); }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void propose({ type: 'skip', candidateId: match.id }); }
    };
    document.addEventListener('keydown', handle); return () => document.removeEventListener('keydown', handle);
  }, [match, view, approval, selectedDonor, busy, propose, reviewEmail, reviewAddress]);
  function navigate(next: View, fromAgent = false) { if (!fromAgent) setAgentActivity(null); setDonorFilter(null); setView(next); setQuery(''); setReviewEmail(''); setReviewAddress(''); }
  async function confirm() {
    if (!approval) return;
    const action = approval.action;
    const mergingRecords = action.type === 'merge' ? data?.matches.filter(item => action.candidateIds.includes(item.id)).flatMap(item => item.recordIds) || [] : [];
    const previousMergeIds = new Set(data?.merges.map(item => item.id));
    setBusy(true); setError('');
    try {
      const response = await request<{ message: string }>('/api/confirm', { id: approval.id });
      setNotice(response.message); setApproval(null); setReviewEmail(''); setReviewAddress('');
      const latest = await refresh();
      voiceControls.current?.notifySaved(response.message);
      setMergeProof(null);
      if (action.type === 'contact') {
        setUndoAction({ type: 'undoContact', donorId: action.donorId });
        setActiveCall(null); setShowDone(false);
      }
      else if (action.type === 'merge') {
        const merge = latest?.merges.find(item => !item.undone && !previousMergeIds.has(item.id) && item.recordIds.some(id => mergingRecords.includes(id)));
        if (merge) {
          setUndoAction({ type: 'undo', mergeId: merge.id });
          const combinedDonor = latest?.donors.find(item => item.id === merge.donorId);
          if (combinedDonor) setMergeProof({ donorId: combinedDonor.id, name: combinedDonor.name, transactions: combinedDonor.gifts.length });
        }
      } else if (action.type === 'skip' || action.type === 'reject') setUndoAction({ type: 'undoReview', candidateId: action.candidateId });
      else if (action.type === 'editContact') setUndoAction({ type: 'undoEditContact', donorId: action.donorId });
      else setUndoAction(null);
      if (action.type === 'skip') setDeferredThisVisit(previous => [...previous, action.candidateId]);
      if (action.type === 'reset') { setDeferredThisVisit([]); setShowLater(false); setImportReport(null); }
      setOutreachInput(null); setEditContact(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | File[]) {
    if (!files.length) return;
    setBusy(true); setError(''); setImportReport(null);
    try {
      uploadFilesRef.current = Array.from(files);
      const body = new FormData(); Array.from(files).forEach(file => body.append('files', file));
      body.append('mapping', JSON.stringify(columnChoices)); body.append('sources', JSON.stringify(sourceChoices));
      const response = await fetch('/api/import', { method: 'POST', body }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'We could not read that file.');
      setImportReport(result); setMergeProof(null); await refresh(); setNotice(`${result.imported} new gifts added. ${result.skipped} not added.`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function getNote(flag: LateFlag) {
    setNoteBusy(true); setError('');
    try { const response = await request<{ note: string; mode: string }>('/api/note', { donorId: flag.donorId, language, giveMiami, format: formatChoices[flag.donorId] ?? 'note' }); setDrafts(old => ({ ...old, [flag.donorId]: response.note })); setDraftModes(old => ({ ...old, [flag.donorId]: response.mode })); }
    catch (e) { setError((e as Error).message); }
    finally { setNoteBusy(false); }
  }
  const fallbackNote = (flag: LateFlag) => `Hi ${flag.name.split(' ')[0]},\n\nI wanted to check in and thank you for being part of the Tidepath community. Your support since ${flag.firstGiftYear} means so much to us. We haven’t seen your usual ${flag.pattern} gift in our latest records, so I wanted to make sure everything is okay. If you have already given, thank you! Please let me know if I can help with anything.\n\nWarmly,\nDenise`;
  async function copyNote(text: string) { try { await navigator.clipboard.writeText(text); setNotice('Note copied. It is ready to paste into your email.'); } catch { setNotice('Please select the note and copy it with your keyboard.'); } }
  async function signIn(value: string) {
    setBusy(true); setError('');
    try { await request('/api/login', { password: value }); setPassword(''); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  function onAssistantResult(response: CommandResult) {
    if (response.note) {
      const id = response.donorId;
      if (id) {
        setDrafts(previous => ({ ...previous, [id]: response.note! }));
        setDraftModes(previous => ({ ...previous, [id]: response.mode }));
        // Land the draft where it gets used: the follow-up editor when the donor is on the call list, otherwise the donor record.
        if (data?.flags.some(flag => flag.donorId === id)) {
          if (!openFlags.some(flag => flag.donorId === id)) setShowDone(true);
          setSelectedDonor(null); navigate('calls', true); setActiveCall(id); setOutreachInput(null);
        } else { navigate('donors', true); setSelectedDonor(id); }
      }
      return;
    }
    if (response.view) { if (!response.donorId) setSelectedDonor(null); navigate(response.view, true); }
    if (response.donorIds) { setView('donors'); setQuery(''); setDonorFilter(response.donorIds); }
    if (response.donorId) setSelectedDonor(response.donorId);
    if (response.approval) setApproval(current => current ?? response.approval!);
  }
  if (needsLogin) return (
    <main className="login-page">
      <div className="login-card">
        <span className="wordmark">GiftGuard.</span>
        <div className="login-heading"><h1>Welcome back.</h1><p>Sign in to your Tidepath workspace.</p></div>
        <form onSubmit={e => { e.preventDefault(); void signIn(password); }}>
          <label htmlFor="staff-password">Staff password</label>
          <Input id="staff-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          <Button type="submit" disabled={busy} className="full-width">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <Button variant="outline" disabled={busy} className="full-width" onClick={() => void signIn('giftguard-demo')}>Explore the sample workspace</Button>
        <p className="login-caption">Sample workspace uses made-up donor information.</p>
        {error && <p role="alert" className="inline-error">{error}</p>}
      </div>
    </main>
  );
  if (!data) return <main className="loading-page"><span className="wordmark">GiftGuard.</span><p role="status">{error || 'Opening your workspace…'}</p>{error ? <Button onClick={() => void refresh().catch(e => setError(e.message))}>Try again</Button> : <Loader2 size={20} className="loading-spinner" aria-hidden="true" />}</main>;

  const journey = buildJourney(data);
  const missingSources = journey.missingSources;
  /** Shows an upload back as a table. Read-only: it never changes what was imported. */
  async function openFile(source: Source, name?: string) {
    setFileQuery('');
    setFileView(old => ({ source, file: name && old?.file?.file === name ? old.file : null, files: old?.source === source ? old.files : [], loading: true, error: '' }));
    try {
      const list = await request<{ files: (UploadedFile & { rows: number })[] }>('/api/file');
      const files = list.files.filter(item => item.source === source).map(item => ({ file: item.file, rows: item.rows, importedAt: item.importedAt }));
      const target = name ?? files[0]?.file;
      if (!target) { setFileView({ source, file: null, files, loading: false, error: 'Nothing has been uploaded for this source yet.' }); return; }
      const file = await request<UploadedFile>(`/api/file?name=${encodeURIComponent(target)}`);
      setFileView({ source, file, files, loading: false, error: '' });
    } catch (e) { setFileView(old => old ? { ...old, loading: false, error: e instanceof Error ? e.message : 'The file could not be loaded.' } : old); }
  }
  const fileRows = fileView?.file ? fileView.file.rows.filter(row => !fileQuery.trim() || Object.values(row).some(value => value.toLowerCase().includes(fileQuery.trim().toLowerCase()))) : [];

  const hasUploadQuestions = Boolean(importReport?.needsMapping?.length || importReport?.needsSource?.length);
  function reviewSaved() { setDeferredThisVisit([]); setShowLater(true); navigate('matches'); }
  function focusUploadQuestions() {
    const fields = [...document.querySelectorAll<HTMLSelectElement>('.import-question select')];
    const field = fields.find(item => !item.value) || fields[0];
    field?.focus(); field?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  function nextStep() {
    if (hasUploadQuestions) { focusUploadQuestions(); return; }
    if (journey.next.task === 'upload') { fileRef.current?.click(); return; }
    if (journey.next.task === 'saved') { reviewSaved(); return; }
    if (journey.next.task === 'duplicates') setShowLater(false);
    navigate(journey.next.view);
  }
  // A filtered list keeps the assistant's order, so a ranking such as biggest donors reads top to bottom.
  const shownDonors = data.donors.filter(item => !donorFilter || donorFilter.includes(item.id)).filter(item => `${item.name} ${item.email} ${item.phone}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => donorFilter ? donorFilter.indexOf(a.id) - donorFilter.indexOf(b.id) : 0);
  const relatedMerges = donor ? data.merges.filter(item => item.donorId === donor.id || item.recordIds.some(id => donor.records.some(record => record.id === id))) : [];
  const unresolvedImport = Boolean(importReport?.needsMapping?.some(item => item.missing.some(field => !columnChoices[item.file]?.[field]))) || Boolean(importReport?.needsSource?.some(item => !sourceChoices[item.file]));
  const mergeAction: Action | null = match ? { type: 'merge', candidateIds: [match.id], ...(reviewEmail ? { email: reviewEmail } : {}), ...(reviewAddress ? { address: reviewAddress } : {}) } : null;
  // The steps are the overview: each row shows its state, and only the suggested step carries the button. Every row stays clickable.
  const currentStep: 'upload' | 'duplicates' | 'calls' | 'done' = hasUploadQuestions ? 'upload' : journey.next.task === 'saved' ? 'duplicates' : journey.next.task;
  const latestUpload = data.sources.map(item => item.importedAt).sort().at(-1);
  const filesDetail = hasUploadQuestions ? 'Answer the questions below to finish this upload'
    : journey.sampleLoaded ? `4 sample files loaded${latestUpload ? ` · last upload ${date(latestUpload)}` : ''}`
      : journey.filesReady ? `4 sources uploaded this week${latestUpload ? ` · last upload ${date(latestUpload)}` : ''}`
        : journey.outdatedSources.length ? `${journey.sourceCount} of 4 sources · ${journey.outdatedSources.length} need this week’s export`
          : `${journey.sourceCount} of 4 sources added · drop CSV or Excel files here`;
  const duplicatesDetail = journey.duplicateCount === 0 ? 'No groups waiting'
    : journey.pendingDuplicates && journey.savedDuplicates ? `${journey.pendingDuplicates} new · ${journey.savedDuplicates} saved for later`
      : journey.pendingDuplicates ? `${journey.pendingDuplicates} ${journey.pendingDuplicates === 1 ? 'group needs' : 'groups need'} a decision`
        : `${journey.savedDuplicates} saved for later`;
  const contactedCount = data.flags.length - openFlags.length;
  const callsDetail = journey.callCount ? `${journey.callCount} ${journey.callCount === 1 ? 'person' : 'people'} to reach out to${contactedCount ? ` · ${contactedCount} contacted` : ''}`
    : contactedCount ? `All ${contactedCount} contacted or snoozed` : 'No follow-ups waiting';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="app-header">
          <button className="wordmark" onClick={() => navigate('home')} aria-label="GiftGuard Start">GiftGuard<span>.</span></button>
          <nav aria-label="Main navigation">
            {navigation.map(item => {
              const count = item.id === 'matches' ? journey.duplicateCount : item.id === 'calls' ? journey.callCount : 0;
              const countLabel = item.id === 'matches' ? `${count} unresolved duplicate groups` : `${count} donors need follow-up`;
              return <button data-agent-target={`nav-${item.id}`} key={item.id} onClick={() => navigate(item.id)} aria-current={view === item.id ? 'page' : undefined} aria-label={count > 0 ? `${item.label}, ${countLabel}` : item.label}>{item.label}{count > 0 && <span className="nav-count" aria-hidden="true">{count}</span>}</button>;
            })}
          </nav>
          {undoAction && <Button variant="ghost" size="sm" className="header-undo" disabled={busy} onClick={() => void propose(undoAction)}><Undo2 size={14} />Undo</Button>}
          <span className="organization">Tidepath <span> / Denise</span></span>
        </header>

        <main className="main-content" id="main-content">
          <div className="workspace-meta">
            <span>{data.demo ? 'Sample workspace' : 'Tidepath Family Alliance'}</span>
            <span>{date(data.today)}{data.demo && <HelpTip label="sample workspace">All donors are made up. The demo date is fixed so the review examples stay consistent.</HelpTip>}</span>
          </div>
          <div className="page-heading">
            {view !== 'home' && <Button variant="ghost" size="sm" className="back-to-start" onClick={() => navigate('home')}>← Back to Start</Button>}
            <h1>{view === 'home' ? 'Your weekly review' : view === 'matches' ? 'Review duplicates' : view === 'calls' ? 'Calls this week' : 'All donors'}</h1>
            {view === 'home' && <p className="overview-line" data-agent-target="overview-summary" aria-label="Workspace summary">
              <span>{journey.sourceCount} of 4 sources</span>
              <span>{data.giftCount.toLocaleString()} transactions</span>
              <span>{journey.duplicateCount ? <><strong>{journey.duplicateCount}</strong> duplicate {journey.duplicateCount === 1 ? 'group' : 'groups'} waiting</> : 'No duplicates waiting'}</span>
              <span>{journey.callCount ? <><strong>{journey.callCount}</strong> {journey.callCount === 1 ? 'donor' : 'donors'} to contact</> : 'No follow-ups waiting'}</span>
            </p>}
            {view !== 'home' && <p>{view === 'matches' ? 'Compare the names and contact details. Combine if they match, choose Different people if they don’t, or save the group for Later.' : view === 'calls' ? 'Check the reason, contact the donor, then record what happened.' : 'Your reference directory. Open a donor to see their contact details and full giving history.'}</p>}
          </div>

          {error && !approval && <div className="feedback error" role="alert"><p>{error}</p><Button variant="ghost" size="icon-sm" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></Button></div>}
          {notice && <div data-agent-target="workspace-notice" className="feedback" role="status"><Check size={16} aria-hidden="true" /><p>{notice}</p><Button variant="ghost" size="icon-sm" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></Button></div>}
          {!journey.filesReady && (missingSources.length > 0 || journey.outdatedSources.length > 0) && <div className="source-warning">{missingSources.length > 0 && <strong>Missing files: {missingSources.map(source => sources[source]).join(', ')}.</strong>}{journey.outdatedSources.length > 0 && <p>Refresh these sources: {journey.outdatedSources.map(source => sources[source]).join(', ')}.</p>}<p>Add current exports before relying on the call list. Upload dates alone do not confirm complete coverage.</p>{view !== 'home' && <Button variant="outline" size="sm" onClick={() => navigate('home')}>Go to uploads</Button>}</div>}

          {view === 'home' && <>
            <ol className="journey-steps" aria-label="Your weekly steps">
              <li className={`${currentStep === 'upload' ? 'current' : ''} ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) void upload(e.dataTransfer.files); }}>
                <button className="step-main" disabled={busy} onClick={() => fileRef.current?.click()} aria-describedby="step-files-hint">
                  <span className={`step-marker ${journey.filesReady ? 'ready' : ''}`}>{journey.filesReady ? <Check size={14} aria-label="Files ready" /> : '1'}</span>
                  <span className="step-text"><strong>Add files</strong><small id="step-files-hint">{filesDetail}</small></span>
                </button>
                <div className="step-side">
                  {currentStep === 'upload'
                    ? <Button disabled={busy} onClick={nextStep}>{busy ? <Loader2 className="loading-spinner" size={16} /> : <Upload size={16} />}{hasUploadQuestions ? 'Finish upload' : busy ? 'Adding files…' : 'Upload files'}</Button>
                    : <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="loading-spinner" size={14} /> : <Upload size={14} />}{busy ? 'Adding…' : 'Upload new files'}</Button>}
                </div>
                <input ref={fileRef} type="file" multiple accept=".csv,.xlsx,.xls" className="sr-only" onChange={e => { if (e.target.files) void upload(e.target.files); }} aria-label="Upload donor spreadsheets" />
                {importReport && <div className="step-body import-report" aria-label="Upload result">
                  <p><strong>{importReport.imported} gifts added.</strong> {importReport.skipped} not added.</p>
                  {importReport.warnings.map((warning, index) => <p className="import-warning" key={index}>{warning}</p>)}
                  {importReport.needsMapping?.map(item => <div className="import-question" key={item.file}><h3>A quick question about {item.file}</h3>{item.missing.map(field => <label key={field}>Which column contains the {field === 'amount' ? 'gift amount' : field === 'date' ? 'gift date' : 'donor name'}?<select value={columnChoices[item.file]?.[field] || ''} onChange={e => setColumnChoices(old => ({ ...old, [item.file]: { ...old[item.file], [field]: e.target.value } }))}><option value="">Choose a column</option>{item.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>)}
                  {importReport.needsSource?.map(item => <label className="import-question" key={item.file}>Where did {item.file} come from?<select value={sourceChoices[item.file] || ''} onChange={e => setSourceChoices(old => ({ ...old, [item.file]: e.target.value as Source }))}><option value="">Choose a source</option>{(Object.keys(sources) as Source[]).map(source => <option key={source} value={source}>{sources[source]}</option>)}</select></label>)}
                  {(importReport.needsMapping?.length || importReport.needsSource?.length) ? <Button disabled={busy || unresolvedImport} onClick={() => void upload(uploadFilesRef.current)}>Continue upload <ArrowRight size={15} /></Button> : null}
                </div>}
              </li>
              <li className={currentStep === 'duplicates' ? 'current' : ''}>
                <button className="step-main" onClick={() => { if (!journey.pendingDuplicates && journey.savedDuplicates) reviewSaved(); else { setShowLater(false); navigate('matches'); } }}>
                  <span className={`step-marker ${journey.duplicateCount === 0 ? 'ready' : ''}`}>{journey.duplicateCount === 0 ? <Check size={14} aria-label="No duplicates remaining" /> : '2'}</span>
                  <span className="step-text"><strong>Review duplicates</strong><small>{duplicatesDetail}</small></span>
                </button>
                <div className="step-side">
                  {journey.duplicateCount > 0 && <span className="step-count" aria-hidden="true">{journey.duplicateCount}</span>}
                  {currentStep === 'duplicates' && <Button disabled={busy} onClick={nextStep}>{journey.next.button}<ArrowRight size={16} /></Button>}
                </div>
              </li>
              <li className={currentStep === 'calls' ? 'current' : ''}>
                <button className="step-main" onClick={() => navigate('calls')}>
                  <span className={`step-marker ${journey.callCount === 0 ? 'ready' : ''}`}>{journey.callCount === 0 ? <Check size={14} aria-label="No calls remaining" /> : '3'}</span>
                  <span className="step-text"><strong>Contact donors</strong><small>{callsDetail}</small></span>
                </button>
                <div className="step-side">
                  {journey.callCount > 0 && <span className="step-count" aria-hidden="true">{journey.callCount}</span>}
                  {currentStep === 'calls' && <Button disabled={busy} onClick={nextStep}>{journey.next.button}<ArrowRight size={16} /></Button>}
                </div>
              </li>
            </ol>

            <details className="source-details">
              <summary>Files & sources <span>{journey.sourceCount} of 4 sources · {data.giftCount.toLocaleString()} transactions across all dates</span></summary>
              <div className="sources-list">{(Object.keys(sources) as Source[]).map(source => {
                const latest = data.sources.filter(item => item.source === source).sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
                return latest
                  ? <button type="button" key={source} className="source-card" onClick={() => void openFile(source)} aria-label={`View the data uploaded for ${sources[source]}`}><strong>{sources[source]}</strong><span>Uploaded {date(latest.importedAt)}</span><small>Latest gift: {date(latest.throughDate)}</small><small className="source-view"><Table2 size={12} />View data · {latest.file}</small></button>
                  : <div key={source}><strong>{sources[source]}</strong><span>Not uploaded</span><small>Add this source above</small></div>;
              })}</div>
              <p className="secondary-note">Alerts reflect uploaded files. The latest gift date does not confirm that an export is complete.</p>
              {data.demo && <div className="sample-files"><span>Download sample files</span>{(Object.keys(sources) as Source[]).map(source => <a key={source} download href={`/demo/${sampleFiles[source]}.csv`}>{sources[source]}</a>)}</div>}
            </details>
          </>}

          {view === 'matches' && <section className="review-zone" tabIndex={-1} aria-label="Duplicate review">
            <div className="section-toolbar"><span><strong>{journey.duplicateCount} groups left</strong> · {journey.pendingDuplicates} new · {journey.savedDuplicates} saved</span>{journey.savedDuplicates > 0 && <label className="check-label"><input type="checkbox" checked={showLater} onChange={e => { setShowLater(e.target.checked); setDeferredThisVisit([]); }} />Include saved for later</label>}<HelpTip label="review shortcuts">With focus in the review, press A to combine, N for different people, or S for later. Every choice still asks you to confirm.</HelpTip></div>
            {mergeProof && <div className="merge-proof" role="status"><div><strong>One donor. Every transaction kept.</strong><p>{mergeProof.transactions} original transactions are safely kept in {mergeProof.name}’s history.</p></div><Button variant="outline" size="sm" onClick={() => setSelectedDonor(mergeProof.donorId)}>View {mergeProof.name}’s history<ArrowUpRight size={14} /></Button></div>}
            {match ? <>
              <div className="review-heading"><h2>Are these the same person?</h2><Badge variant="outline">{match.confidence} confidence</Badge><HelpTip label="match confidence">Confidence is a suggestion based on the matching fields. Shared household details do not always mean the same person.</HelpTip></div>
              <p className="match-reason">{match.reason}</p>
              <div data-agent-target="match-records" className="records-grid">{matchRecords.map(record => <article className="record" key={record.id}>
                <span className="record-source">{sources[record.source]}</span><h3>{record.name}</h3>
                <dl><dt>Email</dt><dd>{record.email || 'Not recorded'}</dd><dt>Phone</dt><dd className={record.phone && matchRecords.filter(r => r.phone === record.phone).length > 1 ? 'matching-field' : ''}>{record.phone || 'Not recorded'}</dd><dt>Address</dt><dd className={record.address && matchRecords.filter(r => r.address === record.address).length > 1 ? 'matching-field' : ''}>{record.address || 'Not recorded'}</dd></dl>
                <p className="record-file">{record.sourceFile}</p>
              </article>)}</div>
              <details className="contact-choice-details"><summary>Contact details to keep <span>Most recent by default</span></summary><div className="contact-choices"><label>Email<select value={reviewEmail} onChange={e => setReviewEmail(e.target.value)}><option value="">Most recent email</option>{[...new Set(matchRecords.map(r => r.email).filter(Boolean))].map(email => <option key={email}>{email}</option>)}</select></label><label>Address<select value={reviewAddress} onChange={e => setReviewAddress(e.target.value)}><option value="">Most recent address</option>{[...new Set(matchRecords.map(r => r.address).filter(Boolean))].map(address => <option key={address}>{address}</option>)}</select></label></div></details>
              <div className="review-footer"><p>{matchGifts.length} gifts · {money(matchGifts.reduce((sum, gift) => sum + gift.amountCents, 0))} kept. Merges can be undone.</p><div className="action-row"><Button disabled={busy} onClick={() => mergeAction && void propose(mergeAction)}>Combine records</Button><Button variant="outline" disabled={busy} onClick={() => void propose({ type: 'reject', candidateId: match.id })}>Different people</Button><Button variant="ghost" disabled={busy} onClick={() => void propose({ type: 'skip', candidateId: match.id })}>Later</Button></div></div>
              <details className="review-more"><summary>More review options</summary><ul className="evidence-list">{match.evidence.map(item => <li key={item}>{item}</li>)}</ul>{pending.filter(item => item.confidence === 'High').length > 1 && <Button variant="outline" disabled={busy} onClick={() => void propose({ type: 'merge', candidateIds: pending.filter(item => item.confidence === 'High').map(item => item.id) })}>Review all {pending.filter(item => item.confidence === 'High').length} high-confidence groups</Button>}</details>
            </> : <div className="empty-state"><h2>{journey.savedDuplicates ? `No new groups. ${journey.savedDuplicates} saved for later.` : "Duplicates reviewed."}</h2><p>{journey.savedDuplicates ? "Saved groups still count as unfinished. You can return to them whenever you’re ready." : "Every current suggestion has a decision. Your next step is to contact donors who may need a check-in."}</p><div className="empty-actions">{journey.callCount > 0 && <Button onClick={() => navigate('calls')}>Continue to {journey.callCount} calls<ArrowRight size={15} /></Button>}{journey.savedDuplicates > 0 && <Button variant={journey.callCount ? 'outline' : 'default'} onClick={reviewSaved}>Review saved groups</Button>}<Button variant="ghost" onClick={() => navigate('home')}>Back to Start</Button></div></div>}
          </section>}

          {view === 'calls' && <>
            <div className="section-toolbar"><Input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a donor" aria-label="Search follow-up list" /><label className="check-label"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Include contacted</label></div>
            <p className="records-notice">Check your latest files before reaching out. A missing gift does not confirm a failed payment.</p>
            {flags.length ? <div className="follow-up-layout">
              <div data-agent-target="follow-up-list" className="follow-up-list" aria-label="Donors to contact">{flags.map(flag => {
                const contact = data.outreach.find(item => item.donorId === flag.donorId);
                return <button className={call?.donorId === flag.donorId ? 'selected' : ''} key={flag.donorId} aria-pressed={call?.donorId === flag.donorId} onClick={() => { setActiveCall(flag.donorId); setOutreachInput(null); }}><strong>{flag.name}</strong><span>{contact && !needsOutreach(flag, data.outreach, data.today) ? contact.status : `${flag.daysLate} days late`}</span><small>{money(flag.usualAmountCents)} · {flag.pattern === 'annual' ? 'yearly' : flag.pattern}</small></button>;
              })}</div>
              {call && <article data-agent-target="follow-up-detail" className="follow-up-detail">
                <div className="call-step-label">1 · Check why they’re here</div><div className="donor-heading"><div><h2>{call.name}</h2><p>{call.reason}</p></div><Button variant="ghost" size="icon-sm" aria-label={`Open ${call.name}'s history`} onClick={() => setSelectedDonor(call.donorId)}><ArrowUpRight size={18} /></Button></div>
                <dl className="gift-facts"><div><dt>Last gift</dt><dd>{money(call.lastAmountCents)}<span>{date(call.lastGiftDate)}</span></dd></div><div><dt>Usual gift</dt><dd>{money(call.usualAmountCents)}<span>{call.pattern === 'annual' ? 'Yearly' : call.pattern === 'quarterly' ? 'Every three months' : 'Monthly'}</span></dd></div><div><dt>Expected</dt><dd>{date(call.expectedDate)}<span>{call.daysLate} days ago</span></dd></div></dl>
                <div className="call-step-label">2 · Contact the donor</div><div className="donor-contact-options"><span>{callDonor?.phone ? <a href={`tel:${callDonor.phone}`}>{callDonor.phone}</a> : 'No phone recorded'}</span><span>{callDonor?.email ? <a href={`mailto:${callDonor.email}`}>{callDonor.email}</a> : 'No email recorded'}</span></div><p className="contact-instruction">Use the note below for your call or email. GiftGuard does not send it.</p><div className="note-heading"><h3>Your draft</h3><Badge variant="secondary">{draftModes[call.donorId] === 'ai' ? 'AI draft' : 'Sample draft'}</Badge><HelpTip label="draft facts">Review before sending. Based on giving since {call.firstGiftYear}, a usual {call.pattern} gift of {money(call.usualAmountCents)}{call.program ? `, and ${call.program}` : ''}. Estimated yearly giving: {money(call.annualValueCents)}. This is a past pattern, not promised income.</HelpTip></div>
                <Textarea data-agent-target={`draft:${call.donorId}`} className="note-editor" value={drafts[call.donorId] ?? fallbackNote(call)} onChange={e => setDrafts(old => ({ ...old, [call.donorId]: e.target.value }))} aria-label={`Editable note for ${call.name}`} />
                <div className="note-controls"><Button variant="outline" size="sm" onClick={() => void copyNote(drafts[call.donorId] ?? fallbackNote(call))}><Copy size={14} />Copy note</Button><details className="draft-options"><summary>Rewrite options</summary><div><label>Format<select value={formatChoices[call.donorId] ?? 'note'} onChange={e => setFormatChoices(previous => ({ ...previous, [call.donorId]: e.target.value as DraftFormat }))}><option value="note">Short note</option><option value="email">Email</option><option value="text_message">Text message</option><option value="call_script">Call script</option></select></label><label>Language<select value={language} onChange={e => setLanguageOverrides(previous => ({ ...previous, [call.donorId]: e.target.value as 'en' | 'es' }))}><option value="en">English</option><option value="es">Español</option></select></label><label className="check-label"><input type="checkbox" checked={giveMiami} onChange={e => setGiveMiami(e.target.checked)} />Mention Give Miami Day</label><Button variant="outline" size="sm" disabled={noteBusy} onClick={() => void getNote(call)}>{noteBusy ? 'Writing…' : 'Rewrite note'}</Button></div></details></div>
                <div className="outreach-section"><div className="call-step-label">3 · Record what happened</div><p className="outcome-instruction">After you reach out, choose an outcome. Or snooze this donor for two weeks.</p><Input placeholder="Quick result (optional)" aria-label="Outreach result" value={resultNote} onChange={e => setOutreachInput({ donorId: call.donorId, status: contactStatus, result: e.target.value })} /><div className="outreach-actions"><label className="sr-only" htmlFor="outreach-status">Follow-up outcome</label><select id="outreach-status" value={contactStatus} onChange={e => setOutreachInput({ donorId: call.donorId, status: e.target.value as ContactStatus | '', result: resultNote })}><option value="" disabled>Choose an outcome</option>{(['Called', 'Emailed', 'Left message', 'Snoozed'] as ContactStatus[]).map(status => <option key={status} value={status}>{status === 'Snoozed' ? 'Snooze for 2 weeks' : status}</option>)}</select><Button disabled={busy || !contactStatus} onClick={() => { if (contactStatus) void propose({ type: 'contact', donorId: call.donorId, status: contactStatus, result: resultNote }); }}>{contactStatus === 'Snoozed' ? 'Snooze 2 weeks' : 'Save follow-up'}</Button></div>{data.outreach.some(item => item.donorId === call.donorId) && <Button variant="ghost" size="sm" onClick={() => void propose({ type: 'undoContact', donorId: call.donorId })}><Undo2 size={14} />Undo last follow-up</Button>}</div>
              </article>}
            </div> : <div className="empty-state"><h2>{query ? 'No donors match this search.' : 'No calls left for now.'}</h2><p>{query ? 'Clear the search to return to your list.' : 'Your current follow-ups are complete or snoozed. Add fresh exports next week to check again.'}</p><div className="empty-actions">{query ? <Button variant="outline" onClick={() => setQuery('')}>Clear search</Button> : <><Button onClick={() => navigate('home')}>Back to Start</Button>{journey.savedDuplicates > 0 && <Button variant="outline" onClick={reviewSaved}>Review {journey.savedDuplicates} saved groups</Button>}</>}</div></div>}
          </>}

          {view === 'donors' && <>
            <div className="section-toolbar"><Input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, email, or phone" aria-label="Search donors" /><span>{shownDonors.length} donor{shownDonors.length === 1 ? '' : 's'}</span>{donorFilter && <Button variant="ghost" size="sm" onClick={() => setDonorFilter(null)}>Show everyone</Button>}</div>
            {shownDonors.length ? <div data-agent-target="donor-list" className="donors-table"><div className="donor-table-heading"><span>Name</span><span>Gifts</span><span>Total received</span><span /></div>{shownDonors.map(item => <button className="donor-row" key={item.id} onClick={() => setSelectedDonor(item.id)}><span><strong>{item.name}</strong><small>{item.email || 'No email recorded'}</small></span><span>{item.gifts.length}</span><span>{money(item.gifts.reduce((sum, gift) => sum + gift.amountCents, 0))}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div> : <div className="empty-state"><h2>No matching donors.</h2><p>Try a different name or email.</p></div>}
          </>}

          <footer className="workspace-footer"><span>GiftGuard / Tidepath</span><HelpTip label="data privacy">Donor records stay in this app’s database. When live AI is enabled, selected fields and voice requests are sent to OpenAI. Nothing is sent to donors automatically.</HelpTip>{undoAction && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void propose(undoAction)}><Undo2 size={14} />Undo last change</Button>}{data.demo && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void propose({ type: 'reset' })}>Reset demo</Button>}</footer>
        </main>
        <AgentSpotlight activity={agentActivity} enabled={showAgentActivity && liveVoiceActive} />
        <Assistant onActivity={setAgentActivity} showActivity={showAgentActivity} onShowActivityChange={setShowAgentActivity} voiceControlRef={voiceControls} onLiveChange={setLiveVoiceActive} onResult={onAssistantResult} aiAvailable={data.aiAvailable} suspended={!!approval || !!selectedDonor} approvalPending={!!approval} contextDonorId={selectedDonor || (view === 'calls' ? call?.donorId : undefined)} />
      </div>

      <Dialog open={!!approval} onOpenChange={open => { if (!open && !busy) setApproval(null); }}>
        <DialogContent data-agent-target="approval-card" data-agent-scope="modal" className="confirmation-dialog" showCloseButton={!busy} onOpenAutoFocus={() => { approvalReturnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; }} onCloseAutoFocus={event => { if (selectedDonor) event.preventDefault(); else restoreDialogFocus(event, approvalReturnFocus.current); }}>
          <DialogHeader><DialogTitle>{approval?.title || 'Confirm action'}</DialogTitle><DialogDescription>{approval?.description}</DialogDescription></DialogHeader>
          {error && <p className="inline-error" role="alert">{error}</p>}
          {liveVoiceActive && <div className="action-row"><span className="secondary-note">Live microphone paused for review.</span><Button variant="outline" size="sm" onClick={() => voiceControls.current?.end()}>End live voice</Button></div>}
          <ul className="confirmation-list">{approval?.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {approval && <p className="secondary-note">Only this action will be approved. Expires at {new Date(approval.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>}
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setApproval(null)}>Go back</Button><Button disabled={busy} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Confirm action'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fileView} onOpenChange={open => { if (!open) setFileView(null); }}>
        <DialogContent data-agent-target="file-preview" data-agent-scope="modal" className="file-dialog">
          <DialogHeader><DialogTitle>{fileView ? sources[fileView.source] : 'Uploaded data'}</DialogTitle><DialogDescription>{fileView?.file ? `${fileView.file.file} · uploaded ${date(fileView.file.importedAt)} · ${fileView.file.total.toLocaleString()} gift${fileView.file.total === 1 ? '' : 's'} imported` : 'The rows exactly as they were in your spreadsheet.'}</DialogDescription></DialogHeader>
          {fileView && <>
            <div className="section-toolbar file-toolbar">
              {fileView.files.length > 1 && <label className="file-pick">File<select value={fileView.file?.file || ''} onChange={e => void openFile(fileView.source, e.target.value)} aria-label="Choose which upload to view">{fileView.files.map(item => <option key={item.file} value={item.file}>{item.file} · {item.rows.toLocaleString()} rows</option>)}</select></label>}
              <Input className="search-input" value={fileQuery} onChange={e => setFileQuery(e.target.value)} placeholder="Find in this file" aria-label="Search the uploaded rows" disabled={!fileView.file} />
              {fileView.file && <span>{fileRows.length === fileView.file.rows.length ? `${fileView.file.rows.length.toLocaleString()} rows` : `${fileRows.length.toLocaleString()} of ${fileView.file.rows.length.toLocaleString()} rows`}</span>}
            </div>
            {fileView.error && <p className="inline-error" role="alert">{fileView.error}</p>}
            {fileView.loading && !fileView.file && <p className="secondary-note"><Loader2 className="loading-spinner" size={14} /> Loading the file…</p>}
            {fileView.file && <div className="data-table-wrap" tabIndex={0} aria-label={`Rows from ${fileView.file.file}`}>
              <table className="data-table">
                <thead><tr><th scope="col" className="row-number">#</th>{fileView.file.headers.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
                <tbody>{fileRows.map((row, index) => <tr key={index}><td className="row-number">{index + 1}</td>{fileView.file!.headers.map(header => <td key={header} title={row[header]}>{row[header]}</td>)}</tr>)}</tbody>
              </table>
              {fileRows.length === 0 && <p className="secondary-note empty-table">No rows match “{fileQuery}”.</p>}
            </div>}
            {fileView.file && <p className="secondary-note">Columns and values are shown as they were in the file. {fileView.file.total > fileView.file.rows.length ? `Showing the newest ${fileView.file.rows.length.toLocaleString()} of ${fileView.file.total.toLocaleString()} rows. ` : ''}Rows that were not imported, such as refunds or rows without an amount, were never stored and do not appear here.</p>}
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={!!donor && !approval} onOpenChange={open => { if (!open) closeDonor(); }}>
        <DialogContent data-agent-target={donor ? `donor:${donor.id}` : undefined} data-agent-scope="modal" className="donor-dialog" onOpenAutoFocus={() => { donorReturnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null; }} onCloseAutoFocus={event => { if (approval) event.preventDefault(); else restoreDialogFocus(event, donorReturnFocus.current); }}>
          <DialogHeader><DialogTitle>{donor?.name || 'Donor history'}</DialogTitle><DialogDescription>Contact details and complete giving history.</DialogDescription></DialogHeader>
          {liveVoiceActive && <Button variant="outline" size="sm" onClick={() => voiceControls.current?.end()}>End live voice</Button>}
          {donor && <>
            {editContact ? <div className="edit-contact"><label>Email<Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></label><label>Address<Input value={editAddress} onChange={e => setEditAddress(e.target.value)} /></label><div className="action-row"><Button variant="outline" onClick={() => setEditContact(false)}>Cancel</Button><Button disabled={busy} onClick={() => void propose({ type: 'editContact', donorId: donor.id, email: editEmail, address: editAddress, language: donor.language })}>Review changes</Button></div></div> : <div className="profile-contact"><div><p>{donor.email || 'No email recorded'}</p>{donor.phone && <p>{donor.phone}</p>}<p>{donor.address || 'No address recorded'}</p></div><Button variant="outline" size="sm" onClick={() => { setEditEmail(donor.email); setEditAddress(donor.address); setEditContact(true); }}>Edit contact</Button></div>}
            {drafts[donor.id] && <section data-agent-target={`draft:${donor.id}`}><div className="note-heading"><h3>Your draft</h3><Badge variant="secondary">{draftModes[donor.id] === 'ai' ? 'AI draft' : 'Sample draft'}</Badge></div><Textarea value={drafts[donor.id]} onChange={e => setDrafts(old => ({ ...old, [donor.id]: e.target.value }))} aria-label={`Draft for ${donor.name}`} className="note-editor mb-3 min-h-40"/><div className="action-row" style={{ justifyContent: 'space-between' }}><span className="secondary-note">Edit it here, then copy it into your email or text. GiftGuard does not send it.</span><Button variant="outline" size="sm" onClick={() => void copyNote(drafts[donor.id])}><Copy size={14} />Copy draft</Button></div></section>}
            <div className="profile-summary"><span><strong>{donor.gifts.length}</strong> gifts</span><span><strong>{money(donor.gifts.reduce((sum, gift) => sum + gift.amountCents, 0))}</strong> received</span><span><strong>{donor.records.length}</strong> source records</span></div>
            <section><h3>Giving history</h3><div className="gift-history">{[...donor.gifts].sort((a, b) => b.date.localeCompare(a.date)).map(gift => <div key={gift.id}><span><strong>{date(gift.date)}</strong><small>{sources[gift.source]}{gift.kind === 'purchase' ? ' · Purchase' : ''}{gift.program ? ` · ${gift.program}` : ''}</small></span><strong>{money(gift.amountCents)}</strong></div>)}</div></section>
            <details className="merge-details"><summary>Merge history <span>{relatedMerges.length}</span></summary>{relatedMerges.length ? relatedMerges.map(merge => <div className="merge-history" key={merge.id}><div><strong>{merge.undone ? 'Merge undone' : `${merge.recordIds.length} records combined`}</strong><p>{date(merge.at)} · {merge.reason}</p></div>{!merge.undone && <Button variant="outline" size="sm" disabled={busy} onClick={() => void propose({ type: 'undo', mergeId: merge.id })}><Undo2 size={14} />Undo</Button>}</div>) : <p className="secondary-note">No merges for this donor.</p>}</details>
            <p className="secondary-note">Original records and every gift are preserved.</p>
          </>}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
