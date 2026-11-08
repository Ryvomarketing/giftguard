import { createHash } from 'node:crypto';
import { addSignup, createEvent, listEvents, type SignupInput } from './events';
import { importRows } from './importer';
import { getSnapshot } from './store';
import type { ImportResult, Source, Donor } from './types';

export const DEMO_TODAY = '2026-11-07';
type DemoRow = Record<string, string | number>;
export interface DemoFile { name: string; source: Source; rows: DemoRow[]; csv: string; }
const HEADERS = ['Transaction ID', 'Donor Name', 'Email', 'Phone', 'Address', 'ZIP', 'Gift Amount', 'Gift Date', 'Recurring', 'Source', 'Program', 'Kind', 'Language'];
const FILE_NAMES: Record<Source, string> = { online: 'online-donations.csv', event: 'event-tickets.csv', auction: 'gala-auction.csv', check: 'mailed-checks.csv' };

/** All people, contact details and transactions below are made up. */
export function getDemoFiles(): DemoFile[] {
  const buckets: Record<Source, DemoRow[]> = { online: [], event: [], auction: [], check: [] };
  let nextTransaction = 1;
  const add = (name: string, source: Source, date: string, amount: number, options: Partial<DemoRow> = {}) => {
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '');
    const identity = Number(options.identity ?? nextTransaction);
    const row: DemoRow = {
      'Transaction ID': `${source}-demo-${String(nextTransaction++).padStart(5, '0')}`,
      'Donor Name': name, Email: `${slug}@example.org`, Phone: `202555${String(identity % 100).padStart(2, '0')}00`,
      Address: `${100 + identity} Sample Way`, ZIP: '33130', 'Gift Amount': amount, 'Gift Date': date,
      Recurring: 'no', Source: source, Program: 'Family support', Kind: 'donation', Language: 'en', ...options,
    };
    delete row.identity;
    buckets[source].push(row);
  };
  const repeated = (name: string, source: Source, dates: string[], amount: number, identity: number, extra: Partial<DemoRow> = {}) => {
    const contact = { identity, Phone: `202555${String(identity).padStart(4, '0')}`, ...extra };
    for (const date of dates) add(name, source, date, amount, contact);
  };

  // Four recently interrupted monthly schedules. Miguel is precisely five days late.
  repeated('Miguel Santos', 'online', ['2026-07-02', '2026-08-02', '2026-09-02', '2026-10-02'], 75, 1, { Recurring: 'yes', Language: 'es' });
  repeated('Carmen Vega', 'online', ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'], 100, 2, { Recurring: 'yes', Program: 'After-school learning' });
  repeated('Ana Castillo', 'online', ['2026-06-28', '2026-07-28', '2026-08-28', '2026-09-28'], 35, 3, { Recurring: 'yes', Language: 'es' });
  repeated('Luis Navarro', 'online', ['2026-07-02', '2026-08-02', '2026-09-02', '2026-10-02'], 50, 4, { Recurring: 'yes' });
  // Three annual lapses, including the December donor who skipped 2025.
  repeated('Elena Ruiz', 'check', ['2022-12-12', '2023-12-14', '2024-12-18'], 500, 5, { Language: 'es', Program: 'Family support' });
  repeated('José Benítez', 'check', ['2023-09-12', '2024-09-14', '2025-09-18'], 1000, 6, { Language: 'es', Program: 'Youth mentoring' });
  repeated('Patricia Brooks', 'online', ['2023-10-12', '2024-10-14', '2025-10-18'], 250, 7);
  repeated('Daniel Torres', 'check', ['2026-01-10', '2026-04-10', '2026-07-10'], 200, 8);
  repeated('Isabel Chen', 'online', ['2026-01-15', '2026-04-15', '2026-07-15'], 150, 9, { Program: 'After-school learning' });

  // Three identities, one person. All originals and all gifts must survive merge/undo.
  const rosa = { Phone: '202-555-0101', Address: '120 Sample Palm Avenue', ZIP: '33135', Language: 'es' };
  add('Rosa Delgado', 'online', '2025-03-10', 50, { ...rosa, Email: 'rosa.delgado@example.org' });
  add('Rosa M. Delgado', 'event', '2026-04-18', 100, { ...rosa, Email: 'rosa.m.delgado@example.org', Kind: 'purchase' });
  add('R. Delgado', 'auction', '2026-10-20', 250, { ...rosa, Email: 'rosa.delgado@example.org', Program: 'Youth mentoring' });

  const pairs = [
    ['Gabriel Moreno', 'G. Moreno'], ['Sofia Campos', 'Sofía Campos'], ['Maya Patel', 'Maya R. Patel'],
    ['Charlotte Reed', 'C. Reed'], ['Julian Foster', 'J. Foster'],
  ];
  pairs.forEach(([name, alias], index) => {
    const contact = { Email: `demo.pair.${index}@example.org`, Phone: `20255502${String(index).padStart(2, '0')}`, Address: `${200 + index} Sample Coral Lane` };
    add(name, 'online', '2025-03-05', 75 + index * 25, contact);
    add(alias, 'auction', '2026-10-20', 100 + index * 25, contact);
  });

  // 285 further people produce 300 people in total (307 source identities before review).
  // Each has one source and stable contact details across their history.
  const firstNames = ['Adriana', 'Benjamin', 'Camila', 'Darius', 'Emilia', 'Felix', 'Grace', 'Hector', 'Ines', 'Jasper', 'Keira', 'Lorenzo', 'Mina', 'Noah', 'Olivia', 'Pablo', 'Quinn', 'Renata', 'Samuel'];
  const lastNames = ['Alvarez', 'Bennett', 'Cruz', 'Diaz', 'Ellis', 'Flores', 'Grant', 'Hughes', 'Ibarra', 'James', 'Kim', 'Lopez', 'Martin', 'Nunez', 'Ortiz'];
  const sources: Source[] = ['online', 'event', 'auction', 'check'];
  for (let index = 0; index < 285; index++) {
    const name = `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length)]}`;
    const source = sources[index % sources.length];
    const identity = index + 300;
    const extra = { ZIP: String(33100 + (index % 80)), Kind: source === 'event' || source === 'auction' ? 'purchase' : 'donation', Program: index % 2 ? 'Family support' : 'Youth mentoring' };
    // Deliberately irregular dates so isolated event purchases do not imply an annual obligation.
    repeated(name, source, ['2024-05-18', '2025-08-09', `2026-${index % 2 ? '10-15' : '09-08'}`], 25 + (index % 12) * 25, identity, extra);
  }
  return sources.map(source => {
    const rows = buckets[source];
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = `${HEADERS.join(',')}\n${rows.map(row => HEADERS.map(header => cell(row[header] ?? '')).join(',')).join('\n')}\n`;
    return { name: FILE_NAMES[source], source, rows, csv };
  });
}

/** Initial demo loading is idempotent. A reset is an explicitly approved store action. */
/** One past event with a few guests so the Events page has something to show. Three guests match existing donors; two are new. */
export function seedDemoEvents(donors: Donor[]): void {
  if (listEvents().length) return;
  const event = createEvent({ name: 'Fall Harvest Gala', host: 'Tidepath Family Alliance', date: '2026-10-20' }, DEMO_TODAY, 'staff');
  const byName = (name: string) => donors.find(donor => donor.name === name);
  const rosa = byName('Rosa Delgado'), carmen = byName('Carmen Vega');
  const guests: SignupInput[] = [
    { name: 'Rosa Delgado', email: rosa?.email || 'rosa.delgado@example.org', phone: '', zip: '', language: 'en', pledgeCents: 25000, consent: true },
    { name: 'Carmen V.', email: '', phone: carmen?.phone || '2025550002', zip: '', language: 'es', pledgeCents: null, consent: true },
    { name: 'Miguel Santos', email: '', phone: '', zip: '33130', language: 'es', pledgeCents: 5000, consent: true },
    { name: 'Priya Natarajan', email: 'priya.natarajan@example.org', phone: '3055550199', zip: '33133', language: 'en', pledgeCents: 10000, consent: true },
    { name: 'Theo Marchetti', email: 'theo.marchetti@example.org', phone: '', zip: '33156', language: 'en', pledgeCents: null, consent: true },
  ];
  for (const guest of guests) addSignup(event.id, guest, donors);
}

export function seedDemo(): ImportResult[] {
  if (getSnapshot().donors.length > 0) return [];
  return getDemoFiles().map(file => importRows(file.rows, file.name, file.source, createHash('sha256').update(file.csv).digest('hex'), {
    name: 'Donor Name', email: 'Email', phone: 'Phone', address: 'Address', zip: 'ZIP', amount: 'Gift Amount', date: 'Gift Date',
    recurring: 'Recurring', source: 'Source', transactionId: 'Transaction ID', program: 'Program', kind: 'Kind', language: 'Language',
  }));
}
