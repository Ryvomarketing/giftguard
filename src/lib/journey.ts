import { needsOutreach } from './outreach';
import type { Snapshot, Source } from './types';

export type Journey = {
  pendingDuplicates: number;
  savedDuplicates: number;
  duplicateCount: number;
  callCount: number;
  sourceCount: number;
  currentSourceCount: number;
  missingSources: Source[];
  outdatedSources: Source[];
  filesReady: boolean;
  sampleLoaded: boolean;
  next: {
    task: 'upload' | 'duplicates' | 'calls' | 'saved' | 'done';
    title: string;
    description: string;
    button: string;
    view: 'home' | 'matches' | 'calls' | 'donors';
  };
};
type JourneyInput = Pick<Snapshot, 'today' | 'demo' | 'sources' | 'matches' | 'flags' | 'outreach'>;
const sources: Source[] = ['online', 'event', 'auction', 'check'];
const DAY = 86_400_000;
const easternDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

function calendarDay(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp / DAY;
}

function importedDay(value: string): number | null {
  // Require an explicit offset: a server-local timestamp must not shift the weekly boundary.
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match || calendarDay(match[1]) === null || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parts = easternDate.formatToParts(new Date(timestamp));
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return calendarDay(`${part('year')}-${part('month')}-${part('day')}`);
}

/** A suggested next step, never a lock or a claim that an export contains every gift. */
export function buildJourney(snapshot: JourneyInput): Journey {
  const loaded = new Set(snapshot.sources.map(item => item.source).filter(source => sources.includes(source)));
  const today = calendarDay(snapshot.today);
  const monday = today === null ? null : today - (new Date(today * DAY).getUTCDay() + 6) % 7;
  const current = new Set(snapshot.sources.filter(item => {
    if (!sources.includes(item.source) || today === null || monday === null) return false;
    const day = importedDay(item.importedAt);
    return day !== null && day >= monday && day <= today;
  }).map(item => item.source));
  const missingSources = sources.filter(source => !loaded.has(source));
  const outdatedSources = snapshot.demo ? [] : sources.filter(source => loaded.has(source) && !current.has(source));
  const sampleLoaded = snapshot.demo && missingSources.length === 0;
  const filesReady = sampleLoaded || (!snapshot.demo && current.size === sources.length);
  const pendingDuplicates = snapshot.matches.filter(match => match.status === 'pending').length;
  const savedDuplicates = snapshot.matches.filter(match => match.status === 'skipped').length;
  const callCount = snapshot.flags.filter(flag => needsOutreach(flag, snapshot.outreach, snapshot.today)).length;
  let next: Journey['next'];

  if (!filesReady) {
    next = {
      task: 'upload', view: 'home', button: 'Upload files',
      title: loaded.size === 0 ? 'Start with your four spreadsheets' : missingSources.length
        ? `Add ${missingSources.length} missing ${missingSources.length === 1 ? 'file' : 'files'}` : 'Add this week’s spreadsheets',
      description: snapshot.demo
        ? 'Some sample sources are missing; add the sample files so you can review duplicates and practice follow-ups.'
        : missingSources.length
          ? 'Some sources are missing; upload your latest files and check that each export includes recent gifts.'
          : 'Some sources have not been uploaded this week; add fresh files and check that each export includes recent gifts.',
    };
  } else if (pendingDuplicates > 0) {
    next = {
      task: 'duplicates', view: 'matches', button: 'Review duplicates',
      title: `Review ${pendingDuplicates} possible duplicate ${pendingDuplicates === 1 ? 'group' : 'groups'}`,
      description: sampleLoaded
        ? 'The sample files are already loaded; review these groups before following up.'
        : 'These records may belong to the same people; review each group before following up.',
    };
  } else if (callCount > 0) {
    next = {
      task: 'calls', view: 'calls', button: 'Open follow-up list',
      title: `Contact ${callCount} ${callCount === 1 ? 'donor' : 'donors'}`,
      description: sampleLoaded
        ? 'The sample files are already loaded; check these suggested follow-ups and practice reviewing a note.'
        : 'These donors have a regular gift missing from the uploaded records; check the facts and review a note before reaching out.',
    };
  } else if (savedDuplicates > 0) {
    next = {
      task: 'saved', view: 'matches', button: 'Revisit saved matches',
      title: `Revisit ${savedDuplicates} saved ${savedDuplicates === 1 ? 'group' : 'groups'}`,
      description: sampleLoaded
        ? 'The sample files are already loaded; revisit the duplicate groups you saved for later.'
        : 'These duplicate groups are still unresolved; revisit them when you are ready to decide.',
    };
  } else {
    next = {
      task: 'done', view: 'donors', button: 'Browse donors', title: 'You’re caught up for now',
      description: sampleLoaded
        ? 'The sample files are already loaded and nothing is waiting; you can explore the donor records.'
        : 'No duplicate reviews or follow-ups are waiting in the uploaded records; you can browse donors or return with new files.',
    };
  }
  return {
    pendingDuplicates, savedDuplicates, duplicateCount: pendingDuplicates + savedDuplicates, callCount,
    sourceCount: loaded.size, currentSourceCount: current.size, missingSources, outdatedSources,
    filesReady, sampleLoaded, next,
  };
}
