import type { CommandResult } from './types';

export type AgentActivity = {
  id: string;
  phase: 'working' | 'complete' | 'review' | 'failed' | 'saved';
  label: string;
  targets: string[];
};

/** Presentation describes real tool lifecycle events; it never performs an action. */
export function toolActivity(id: string, name: string, args: Record<string, unknown>, phase: 'working' | 'complete' | 'failed', result?: CommandResult): AgentActivity | null {
  if (!['get_donor_context', 'open_page', 'create_event', 'draft_note', 'propose_change'].includes(name)) return null;
  const donorId = typeof args.donorId === 'string' ? args.donorId : result?.donorId;
  let targets: string[];
  let label: string;
  if (name === 'open_page') {
    const page = args.page;
    const nav = page === 'start' ? 'nav-home' : page === 'duplicates' ? 'nav-matches' : page === 'calls' ? 'nav-calls' : page === 'events' ? 'nav-events' : 'nav-donors';
    targets = phase === 'working' ? [nav] : page === 'start' ? ['overview-summary'] : page === 'duplicates' ? ['match-records'] : page === 'calls' ? ['follow-up-list'] : page === 'events' ? ['event-list'] : ['donor-list'];
    label = phase === 'working' ? 'Opening the page' : page === 'start' ? 'Your weekly review' : page === 'duplicates' ? 'Duplicates ready to review' : page === 'calls' ? 'Calls this week' : page === 'events' ? 'Events' : 'All donors';
  } else if (name === 'create_event') {
    targets = phase === 'working' ? ['nav-events'] : ['event-preview', 'event-detail'];
    label = phase === 'working' ? 'Creating the sign-up list' : 'Your sign-up page is ready';
  } else if (name === 'get_donor_context') {
    const view = args.view;
    const nav = view === 'overview' ? 'nav-home' : view === 'late' ? 'nav-calls' : view === 'matches' ? 'nav-matches' : view === 'events' ? 'nav-events' : 'nav-donors';
    targets = phase === 'working' ? [nav] : view === 'overview' ? ['overview-summary'] : view === 'late' ? ['follow-up-list'] : view === 'matches' ? ['match-records'] : view === 'events' ? ['event-list'] : result?.donorId ? [`donor:${result.donorId}`] : result?.answer ? ['answer-bar', 'donor-list'] : ['donor-list'];
    label = phase === 'working' ? view === 'late' ? 'Finding follow-ups' : view === 'matches' ? 'Checking possible duplicates' : view === 'overview' ? 'Checking your workspace' : view === 'top' ? 'Ranking donors by giving' : view === 'received' ? 'Finding recent gifts' : view === 'events' ? 'Checking sign-up lists' : 'Finding donor records' : view === 'late' ? 'Follow-ups ready' : view === 'matches' ? 'Matches ready to review' : view === 'overview' ? 'Your weekly overview' : view === 'top' ? 'Biggest donors' : view === 'received' ? 'Recent gifts' : view === 'events' ? 'Sign-up lists' : 'Donor records ready';
  } else if (name === 'draft_note') {
    // A group message has no donor record to point at; it appears in the voice panel only.
    targets = phase === 'working' ? [...(donorId ? [`donor:${donorId}`, 'follow-up-detail'] : []), 'voice-panel'] : [...(donorId ? [`draft:${donorId}`] : []), 'voice-draft'];
    label = phase === 'working' ? donorId ? 'Preparing a personal note' : 'Preparing a message' : 'Your draft is ready';
  } else {
    targets = args.action === 'contact' ? ['follow-up-detail', 'nav-calls'] : ['match-records', 'nav-matches'];
    label = 'Preparing your review';
  }
  if (phase === 'failed') return { id, phase, targets, label: 'This request could not finish' };
  if (result?.approval) return { id, phase: 'review', targets: ['approval-card'], label: 'Ready for your review' };
  return { id, phase, label, targets };
}

export function savedActivity(id: string, message: string): AgentActivity {
  return { id, phase: 'saved', label: message.slice(0, 160), targets: ['workspace-notice'] };
}
