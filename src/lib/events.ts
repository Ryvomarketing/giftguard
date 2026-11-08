import { randomBytes, randomUUID } from 'node:crypto';
import { bumpVersion, getStore, transaction } from './store';
import { normalizePhone, normalizeText } from './matching';
import type { Confidence, Donor, Signup, SignupEvent } from './types';

type Row = Record<string, string | number | null>;
const EVENT_TYPES = ['gala', 'fundraiser', 'dinner', 'luncheon', 'breakfast', 'brunch', 'auction', 'benefit', 'concert', 'walk', 'run', '5k', 'golf tournament', 'tournament', 'reception', 'open house', 'volunteer day', 'drive', 'event'];
export const MAX_SIGNUPS_PER_EVENT = 2000;

export function ensureEventTables(): void {
  getStore().exec(`
    CREATE TABLE IF NOT EXISTS signup_events(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,host TEXT NOT NULL,date TEXT NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS signups(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES signup_events(id),name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,zip TEXT NOT NULL,language TEXT NOT NULL,pledge_cents INTEGER,consent INTEGER NOT NULL,created_at TEXT NOT NULL,match_donor_id TEXT,match_name TEXT,match_reason TEXT,match_confidence TEXT);
    CREATE INDEX IF NOT EXISTS signups_event ON signups(event_id);
  `);
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const codeAlphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
function newCode(): string { const bytes = randomBytes(8); return [...bytes].map(byte => codeAlphabet[byte % codeAlphabet.length]).join(''); }

export function validateEventInput(input: { name?: unknown; host?: unknown; date?: unknown }, today: string): { name: string; host: string; date: string } {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const host = String(input.host ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const date = String(input.date ?? '').trim();
  if (name.length < 2) throw new Error('Give the event a name, for example "Miami Foundation Gala".');
  if (!isoDate.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new Error('Give the event a date like 2026-11-21.');
  const todayMs = Date.parse(`${today}T12:00:00Z`), dateMs = Date.parse(`${date}T12:00:00Z`);
  if (dateMs < todayMs - 366 * 86_400_000 || dateMs > todayMs + 3 * 366 * 86_400_000) throw new Error('The event date should be within the last year or the next three years.');
  return { name, host, date };
}

export function createEvent(input: { name?: unknown; host?: unknown; date?: unknown }, today: string, createdBy: 'staff' | 'assistant'): SignupEvent {
  ensureEventTables();
  const valid = validateEventInput(input, today);
  const db = getStore();
  const id = `event_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  let code = newCode();
  while (db.prepare('SELECT id FROM signup_events WHERE code=?').get(code)) code = newCode();
  const createdAt = new Date().toISOString();
  transaction(() => {
    db.prepare('INSERT INTO signup_events VALUES(?,?,?,?,?,?,?)').run(id, code, valid.name, valid.host, valid.date, createdAt, createdBy);
    bumpVersion();
  });
  return { id, code, name: valid.name, host: valid.host, date: valid.date, createdAt, createdBy, signups: [] };
}

/** Only an empty list can be removed; guest sign-ups are never discarded silently. */
export function deleteEvent(id: string): boolean {
  ensureEventTables();
  const db = getStore();
  const count = Number((db.prepare('SELECT COUNT(*) AS n FROM signups WHERE event_id=?').get(id) as Row).n);
  if (count > 0) throw new Error('This list already has sign-ups, so it cannot be removed.');
  let removed = false;
  transaction(() => { removed = db.prepare('DELETE FROM signup_events WHERE id=?').run(id).changes > 0; if (removed) bumpVersion(); });
  return removed;
}

function rowToSignup(r: Row): Signup {
  return { id: String(r.id), eventId: String(r.event_id), name: String(r.name), email: String(r.email), phone: String(r.phone), zip: String(r.zip), language: r.language === 'es' ? 'es' : 'en', pledgeCents: r.pledge_cents === null ? null : Number(r.pledge_cents), consent: !!r.consent, createdAt: String(r.created_at), matchDonorId: r.match_donor_id === null ? null : String(r.match_donor_id), matchName: r.match_name === null ? null : String(r.match_name), matchReason: r.match_reason === null ? null : String(r.match_reason), matchConfidence: r.match_confidence === null ? null : r.match_confidence as Confidence };
}

export function listEvents(): SignupEvent[] {
  ensureEventTables();
  const db = getStore();
  const signups = (db.prepare('SELECT * FROM signups ORDER BY created_at DESC').all() as Row[]).map(rowToSignup);
  return (db.prepare('SELECT * FROM signup_events ORDER BY date DESC, created_at DESC').all() as Row[]).map(r => ({
    id: String(r.id), code: String(r.code), name: String(r.name), host: String(r.host), date: String(r.date), createdAt: String(r.created_at), createdBy: r.created_by === 'assistant' ? 'assistant' : 'staff',
    signups: signups.filter(signup => signup.eventId === r.id),
  }));
}

/** The guest-facing view of an event: nothing but its name, host, date and code. */
export function publicEvent(code: string): { code: string; name: string; host: string; date: string } | null {
  ensureEventTables();
  const r = getStore().prepare('SELECT code,name,host,date FROM signup_events WHERE code=?').get(code.slice(0, 40)) as Row | undefined;
  return r ? { code: String(r.code), name: String(r.name), host: String(r.host), date: String(r.date) } : null;
}

export interface SignupInput { name: string; email: string; phone: string; zip: string; language: 'en' | 'es'; pledgeCents: number | null; consent: boolean; }

export function validateSignupInput(input: Record<string, unknown>): SignupInput {
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 320);
  const phone = String(input.phone ?? '').trim().slice(0, 40);
  const zip = String(input.zip ?? '').trim().slice(0, 20);
  const language = input.language === 'es' ? 'es' : 'en';
  const consent = input.consent === true || input.consent === 'true' || input.consent === 'on';
  if (name.length < 2) throw new Error(language === 'es' ? 'Escribe tu nombre completo.' : 'Please enter your full name.');
  if (!email && !phone) throw new Error(language === 'es' ? 'Deja un correo o un teléfono para que podamos contactarte.' : 'Please leave an email or a phone number so we can reach you.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(language === 'es' ? 'Revisa el correo electrónico.' : 'Please check the email address.');
  if (phone && normalizePhone(phone).length < 7) throw new Error(language === 'es' ? 'Revisa el número de teléfono.' : 'Please check the phone number.');
  if (!consent) throw new Error(language === 'es' ? 'Marca la casilla para que podamos guardar tus datos.' : 'Please tick the box so we may keep your details.');
  let pledgeCents: number | null = null;
  const pledgeText = String(input.pledge ?? '').replace(/[$,\s]/g, '');
  if (pledgeText) {
    const amount = Number(pledgeText);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error(language === 'es' ? 'Revisa el monto de la promesa.' : 'Please check the pledge amount.');
    pledgeCents = Math.round(amount * 100);
  }
  return { name, email, phone, zip, language, pledgeCents, consent };
}

/** Does this guest look like someone already in the donor list? Staff-only; the guest never sees it. */
export function matchSignup(input: Pick<SignupInput, 'name' | 'email' | 'phone' | 'zip'>, donors: Donor[]): { donor: Donor; reason: string; confidence: Confidence } | null {
  const email = input.email.trim().toLowerCase(), phone = normalizePhone(input.phone), name = normalizeText(input.name);
  const lastName = name.split(' ').at(-1) ?? '';
  // When several records share the contact detail (an unresolved duplicate), prefer the one whose name also matches.
  const prefer = (candidates: Donor[]) => candidates.find(d => normalizeText(d.name) === name) ?? candidates[0];
  if (email) { const found = donors.filter(d => d.email.toLowerCase() === email || d.records.some(r => r.email.toLowerCase() === email)); if (found.length) return { donor: prefer(found), reason: 'Same email', confidence: 'High' }; }
  if (phone) { const found = donors.filter(d => normalizePhone(d.phone) === phone || d.records.some(r => normalizePhone(r.phone) === phone)); if (found.length) return { donor: prefer(found), reason: 'Same phone', confidence: 'High' }; }
  if (name) {
    const exact = donors.find(d => normalizeText(d.name) === name);
    if (exact) return { donor: exact, reason: input.zip && exact.records.some(r => r.zip === input.zip) ? 'Same name and ZIP' : 'Same name', confidence: input.zip && exact.records.some(r => r.zip === input.zip) ? 'High' : 'Medium' };
    if (lastName.length > 2 && input.zip) {
      const near = donors.find(d => normalizeText(d.name).split(' ').at(-1) === lastName && d.records.some(r => r.zip === input.zip));
      if (near) return { donor: near, reason: 'Same last name and ZIP', confidence: 'Low' };
    }
  }
  return null;
}

export function addSignup(eventId: string, input: SignupInput, donors: Donor[]): Signup {
  ensureEventTables();
  const db = getStore();
  if (!db.prepare('SELECT id FROM signup_events WHERE id=?').get(eventId)) throw new Error('This sign-up page is no longer available.');
  const count = Number((db.prepare('SELECT COUNT(*) AS n FROM signups WHERE event_id=?').get(eventId) as Row).n);
  if (count >= MAX_SIGNUPS_PER_EVENT) throw new Error('This list is full. Please see a staff member.');
  const match = matchSignup(input, donors);
  const signup: Signup = { id: `signup_${randomUUID().replace(/-/g, '').slice(0, 20)}`, eventId, ...input, createdAt: new Date().toISOString(), matchDonorId: match?.donor.id ?? null, matchName: match?.donor.name ?? null, matchReason: match?.reason ?? null, matchConfidence: match?.confidence ?? null };
  transaction(() => {
    db.prepare('INSERT INTO signups VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(signup.id, eventId, signup.name, signup.email, signup.phone, signup.zip, signup.language, signup.pledgeCents, Number(signup.consent), signup.createdAt, signup.matchDonorId, signup.matchName, signup.matchReason, signup.matchConfidence);
    bumpVersion();
  });
  return signup;
}

export function eventByCode(code: string): SignupEvent | null { return listEvents().find(event => event.code === code) ?? null; }

/** Pulls an event name, host and date out of a sentence like "a new gala for the Miami Foundation on November 21". */
export function parseEventRequest(text: string, today: string): { name: string; host: string; date: string | null } {
  const lower = text.toLowerCase();
  const type = EVENT_TYPES.find(candidate => new RegExp(`\\b${candidate.replace(/ /g, '\\s+')}\\b`).test(lower)) ?? 'event';
  const hostMatch = text.match(/\b(?:for|with|hosted by|benefiting)\s+(?:the\s+)?([A-Z][\w&'’.-]*(?:\s+(?:of|and|the|&|[A-Z][\w&'’.-]*))*)/);
  const host = hostMatch ? hostMatch[1].replace(/\s+(?:on|in|at|this|next|coming)$/i, '').trim() : '';
  const date = parseSpokenDate(text, today);
  const typeLabel = type === '5k' ? '5K' : type.replace(/\b\w/g, letter => letter.toUpperCase());
  const name = host ? `${host} ${typeLabel}` : date ? `${typeLabel} on ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}` : typeLabel;
  return { name, host, date };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parseSpokenDate(text: string, today: string): string | null {
  const lower = text.toLowerCase();
  const iso = lower.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) { const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : null; return withYear(Number(numeric[1]), Number(numeric[2]), year, today); }
  const monthFirst = lower.match(new RegExp(`\\b(${MONTHS.join('|')}|${MONTHS.map(m => m.slice(0, 3)).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`));
  if (monthFirst) return withYear(monthIndex(monthFirst[1]), Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : null, today);
  const dayFirst = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join('|')}|${MONTHS.map(m => m.slice(0, 3)).join('|')})\\.?(?:,?\\s+(20\\d\\d))?\\b`));
  if (dayFirst) return withYear(monthIndex(dayFirst[2]), Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : null, today);
  return null;
}
function monthIndex(word: string): number { const short = word.slice(0, 3); return MONTHS.findIndex(month => month.startsWith(short)) + 1; }
function build(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}
/** A date without a year means the next time it comes around. */
function withYear(month: number, day: number, year: number | null, today: string): string | null {
  if (year !== null) return build(year, month, day);
  const currentYear = Number(today.slice(0, 4));
  const candidate = build(currentYear, month, day);
  return candidate && candidate >= today ? candidate : build(currentYear + 1, month, day);
}
