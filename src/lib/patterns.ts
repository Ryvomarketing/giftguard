import type { Donor, Gift, LateFlag } from './types';

const DAY = 86_400_000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function monthNumber(date: Date): number { return date.getUTCFullYear() * 12 + date.getUTCMonth(); }
function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Calendar arithmetic preserves month-end schedules instead of drifting by 30/90 days. */
export function addCalendarMonths(date: string, months: number, preferredDay?: number): string {
  const parsed = dateValue(date);
  if (!parsed) throw new Error('Use a real calendar date in YYYY-MM-DD format.');
  const target = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1));
  target.setUTCDate(Math.min(preferredDay ?? parsed.getUTCDate(), daysInMonth(target.getUTCFullYear(), target.getUTCMonth())));
  return iso(target);
}

function cadenceDay(dates: Date[]): number {
  // A February clamp must not shift a Jan 31 / Feb 28 / Mar 31 schedule to the 28th.
  const atMonthEnd = dates.every(date => date.getUTCDate() >= daysInMonth(date.getUTCFullYear(), date.getUTCMonth()) - 2);
  return atMonthEnd ? 31 : median(dates.map(date => date.getUTCDate()));
}

// Conservative inference: missing months and holiday shifts across a month boundary
// require staff review. No holiday calendar or payment-schedule integration is available.
function hasCadence(dates: Date[], gap: 1 | 3): boolean {
  if (dates.length < 3) return false;
  const day = cadenceDay(dates);
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const expectedDay = Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth()));
    if (Math.abs(date.getUTCDate() - expectedDay) > (gap === 1 ? 5 : 10)) return false;
    if (i > 0 && monthNumber(date) - monthNumber(dates[i - 1]) !== gap) return false;
  }
  return true;
}

function flagFor(donor: Donor, today: Date): LateFlag | null {
  const gifts = donor.gifts.filter(gift => gift.kind === 'donation' && gift.amountCents > 0 && dateValue(gift.date) && gift.date <= iso(today))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (gifts.length < 2) return null;
  const recurringGifts = gifts.filter(gift => gift.recurring);
  // Three distinct recurring dates are stronger evidence than unrelated one-time gifts.
  // Keep the complete history for first-gift year and the most recent actual donation.
  const cadenceGifts = new Set(recurringGifts.map(gift => gift.date)).size >= 3 ? recurringGifts : gifts;
  const uniqueDates = [...new Set(cadenceGifts.map(gift => gift.date))].map(date => dateValue(date)!);
  const recentDates = uniqueDates.slice(-3);
  const last = cadenceGifts[cadenceGifts.length - 1];
  const latestGift = gifts[gifts.length - 1];
  let pattern: LateFlag['pattern'];
  let expectedDate: string;
  let reason: string;
  let minimumDaysLate: number;
  if (hasCadence(recentDates, 1)) {
    pattern = 'monthly';
    expectedDate = addCalendarMonths(last.date, 1, cadenceDay(recentDates));
    minimumDaysLate = 5;
    reason = 'Monthly gift missing. A card problem is one possible reason; check the donation platform.';
  } else if (hasCadence(recentDates, 3)) {
    pattern = 'quarterly';
    expectedDate = addCalendarMonths(last.date, 3, cadenceDay(recentDates));
    minimumDaysLate = 14;
    reason = 'The usual quarterly gift is missing from the uploaded records.';
  } else {
    // Require a consistent annual season and one gift-date per year. Irregular donors are not labelled late.
    const annualDates = uniqueDates.slice(-4);
    const years = annualDates.map(date => date.getUTCFullYear());
    const month = annualDates[annualDates.length - 1].getUTCMonth();
    if (annualDates.length < 2 || new Set(years).size !== annualDates.length || annualDates.some(date => date.getUTCMonth() !== month)) return null;
    if (years.some((year, index) => index > 0 && year - years[index - 1] !== 1)) return null;
    pattern = 'annual';
    const expectedYear = years[years.length - 1] + 1;
    expectedDate = iso(new Date(Date.UTC(expectedYear, month + 1, 0)));
    minimumDaysLate = 1;
    reason = `The usual ${MONTH_NAMES[month]} gift is missing from the uploaded records for ${expectedYear}.`;
  }
  const daysLate = Math.floor((today.getTime() - dateValue(expectedDate)!.getTime()) / DAY);
  if (daysLate < minimumDaysLate) return null;
  const usualAmountCents = median(cadenceGifts.slice(-3).map(gift => gift.amountCents));
  return {
    donorId: donor.id, name: donor.name, pattern, expectedDate, daysLate,
    lastGiftDate: latestGift.date, lastAmountCents: latestGift.amountCents, usualAmountCents,
    annualValueCents: usualAmountCents * (pattern === 'monthly' ? 12 : pattern === 'quarterly' ? 4 : 1),
    reason, firstGiftYear: Number(gifts[0].date.slice(0, 4)), program: latestProgram(cadenceGifts),
  };
}

function latestProgram(gifts: Gift[]): string {
  return [...gifts].reverse().find(gift => gift.program.trim())?.program ?? '';
}

/** Missing records are a follow-up suggestion, never evidence of a failed payment. */
export function detectLateGifts(donors: Donor[], today: string): LateFlag[] {
  const parsedToday = dateValue(today);
  if (!parsedToday) throw new Error('Use a real calendar date in YYYY-MM-DD format.');
  return donors.map(donor => flagFor(donor, parsedToday)).filter((flag): flag is LateFlag => flag !== null)
    .sort((a, b) => b.annualValueCents - a.annualValueCents || b.daysLate - a.daysLate || a.name.localeCompare(b.name));
}
