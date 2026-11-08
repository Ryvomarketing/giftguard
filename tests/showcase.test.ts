import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { impactSummary, timelineMonths, tourSteps } from '../src/lib/showcase';
import { snapshot } from '../src/lib/service';
import type { LateFlag, MatchCandidate } from '../src/lib/types';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-showcase-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;

const flag = (id: string, annualValueCents: number, daysLate = 7): LateFlag => ({ donorId: id, name: `${id} Person`, pattern: 'monthly', expectedDate: '2026-11-01', daysLate, lastGiftDate: '2026-10-01', lastAmountCents: 5000, usualAmountCents: 5000, annualValueCents, reason: '', firstGiftYear: 2024, program: '' });
const match = (id: string, status: MatchCandidate['status'], records = 2): MatchCandidate => ({ id, status, name: id, recordIds: Array.from({ length: records }, (_, i) => `${id}-${i}`), donorIds: [], confidence: 'High', reason: '', evidence: [], assessedBy: 'rules' });

test('impact counts only open follow-ups and pending duplicate groups', () => {
  const summary = impactSummary({
    today: '2026-11-07',
    flags: [flag('a', 60000), flag('b', 120000), flag('c', 1000)],
    outreach: [{ donorId: 'c', status: 'Called', result: '', at: '2026-11-06T12:00:00Z', snoozedUntil: null }],
    matches: [match('m1', 'pending', 3), match('m2', 'pending'), match('m3', 'approved'), match('m4', 'rejected')],
  });
  assert.equal(summary.atRiskCents, 180000); assert.equal(summary.atRiskDonors, 2);
  assert.equal(summary.duplicateGroups, 2); assert.equal(summary.duplicateRecords, 5);
  const real = impactSummary(snapshot());
  assert.equal(real.atRiskDonors, 9); assert.equal(real.duplicateGroups, 6); assert.ok(real.atRiskCents > 0);
});

test('the timeline covers the last 24 months, sums gifts by month, and marks only an empty expected month', () => {
  const gifts = [
    { date: '2026-10-01', amountCents: 10000, kind: 'donation' as const },
    { date: '2026-10-20', amountCents: 2500, kind: 'donation' as const },
    { date: '2025-06-03', amountCents: 4000, kind: 'purchase' as const },
    { date: '2020-01-01', amountCents: 999999, kind: 'donation' as const },
  ];
  const months = timelineMonths(gifts, '2026-11-07', { expectedDate: '2026-11-01' });
  assert.equal(months.length, 24);
  assert.equal(months[0].month, '2024-12'); assert.equal(months.at(-1)!.month, '2026-11');
  const october = months.find(m => m.month === '2026-10')!;
  assert.equal(october.cents, 12500); assert.equal(october.count, 2); assert.equal(october.purchaseOnly, false); assert.equal(october.label, 'Oct');
  assert.equal(months.find(m => m.month === '2025-06')!.purchaseOnly, true);
  const november = months.at(-1)!;
  assert.equal(november.expectedMissing, true); assert.equal(november.isToday, true);
  assert.equal(months.filter(m => m.expectedMissing).length, 1);
  // An expected month that did receive a gift is not marked missing.
  assert.equal(timelineMonths(gifts, '2026-11-07', { expectedDate: '2026-10-05' }).some(m => m.expectedMissing), false);
  assert.equal(timelineMonths(gifts, '2026-11-07', null, 6).length, 6);
});

test('the tour is told with the workspace numbers, visits every page, and changes nothing', () => {
  const data = snapshot();
  const steps = tourSteps({ ...data, sourceCount: 4 });
  assert.deepEqual(steps.map(step => step.view), ['home', 'matches', 'calls', 'donors', 'events', 'home']);
  assert.match(steps[0].say, /899 transactions/); assert.match(steps[0].say, /over \$6,000 in regular giving at risk/); assert.doesNotMatch(steps[0].say, /6,270/); assert.match(steps[0].say, /6 donors who appear more than once/);
  assert.match(steps[2].say, /days late/);
  assert.match(steps[3].say, new RegExp(`${data.donors.length} donors`));
  assert.match(steps[4].say, /Fall Harvest Gala/); assert.match(steps[4].say, /5 guests signed up/); assert.match(steps[4].say, /already known donors/); assert.equal(steps[4].eventId, data.events[0].id); assert.deepEqual(steps[4].targets, ['event-preview', 'event-detail', 'event-list']);
  const noEvents = tourSteps({ ...data, events: [], sourceCount: 4 });
  assert.match(noEvents[4].say, /make me a sign-up list/); assert.equal(noEvents[4].eventId, undefined); assert.ok(noEvents[4].targets.includes('nav-events'));
  assert.ok(steps.every(step => step.say.length < 400 && step.targets.length > 0 && !step.say.includes('@')));
  const quiet = tourSteps({ ...data, flags: [], matches: [], sourceCount: 4 });
  assert.match(quiet[0].say, /Nothing is at risk/); assert.doesNotMatch(quiet[2].say, /late/);
  assert.equal(JSON.stringify(snapshot().flags), JSON.stringify(data.flags));
  const spanish = tourSteps({ ...data, sourceCount: 4 }, 'es');
  assert.deepEqual(spanish.map(step => step.view), steps.map(step => step.view));
  assert.match(spanish[0].say, /^¡Qué más! Bienvenidos a GiftGuard\./); assert.match(spanish[4].say, /se anotaron desde el celular/); assert.match(spanish[1].say, /Tranquilo/); assert.match(steps[0].say, /^Welcome to GiftGuard!/); assert.match(spanish[0].say, /899 transacciones/); assert.match(spanish[0].say, /más de \$6,000/); assert.match(spanish[2].say, /días de retraso/); assert.match(spanish[4].say, /Fall Harvest Gala/); assert.equal(spanish[4].eventId, steps[4].eventId);
  assert.ok(spanish.every((step, index) => step.say !== steps[index].say && step.targets.join() === steps[index].targets.join()));
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
