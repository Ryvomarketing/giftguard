import type { Donor, Snapshot } from './types';

/** What the screen shows alongside a spoken answer about a group of donors. */
export interface Answer { label: string; count: number; totalCents: number | null; }

export interface AnswerWindow { since: string; until: string; label: string; }

const iso = (date: Date) => date.toISOString().slice(0, 10);
const shiftDays = (day: string, days: number) => iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000));
const monthName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Turns period words ("this month", "last 30 days", "since the last upload") into a dated window. Defaults to the current calendar month. */
export function receivedWindow(text: string | null | undefined, data: Pick<Snapshot, 'today' | 'sources'>): AnswerWindow {
  const lower = (text ?? '').toLowerCase();
  const today = data.today;
  if (/\b(30|thirty) days\b|\bpast month\b/.test(lower)) return { since: shiftDays(today, -30), until: today, label: 'Gave in the last 30 days' };
  if (/\b(7|seven) days\b|\bthis week\b|\bpast week\b|\blast week\b/.test(lower)) return { since: shiftDays(today, -7), until: today, label: 'Gave in the last 7 days' };
  if (/\b(since|after|from)\b.*\bupload|\blast upload\b|\blatest upload\b|\bnew gifts?\b|\bcame in\b/.test(lower)) {
    const latest = data.sources.map(source => source.importedAt.slice(0, 10)).sort().at(-1);
    if (latest) return { since: latest, until: today, label: `Gave since the last upload (${shortDate(latest)})` };
  }
  if (/\blast month\b/.test(lower)) {
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const previous = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));
    const since = iso(previous);
    return { since, until: shiftDays(today.slice(0, 7) + '-01', -1), label: `Gave in ${monthName(since)}` };
  }
  if (/\bthis year\b|\byear to date\b/.test(lower)) return { since: `${today.slice(0, 4)}-01-01`, until: today, label: `Gave in ${today.slice(0, 4)}` };
  return { since: `${today.slice(0, 7)}-01`, until: today, label: `Gave in ${monthName(today)}` };
}

export interface ReceivedDonor { donor: Donor; cents: number; count: number; latestDate: string; }

/** Donors with at least one donation inside the window, most recent gift first. Purchases are not payments of a pledge, so they are excluded. */
export function receivedDonors(data: Pick<Snapshot, 'donors'>, window: AnswerWindow): ReceivedDonor[] {
  const result: ReceivedDonor[] = [];
  for (const donor of data.donors) {
    const gifts = donor.gifts.filter(gift => gift.kind === 'donation' && gift.date >= window.since && gift.date <= window.until);
    if (!gifts.length) continue;
    result.push({ donor, cents: gifts.reduce((sum, gift) => sum + gift.amountCents, 0), count: gifts.length, latestDate: gifts.map(gift => gift.date).sort().at(-1)! });
  }
  return result.sort((a, b) => b.latestDate.localeCompare(a.latestDate) || b.cents - a.cents || a.donor.name.localeCompare(b.donor.name));
}

export function receivedAnswer(window: AnswerWindow, donors: ReceivedDonor[]): Answer {
  return { label: window.label, count: donors.length, totalCents: donors.reduce((sum, item) => sum + item.cents, 0) };
}
