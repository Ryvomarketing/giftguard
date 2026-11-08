import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourney } from '../src/lib/journey';
import type { LateFlag, MatchCandidate, Outreach, Snapshot, Source, SourceFreshness } from '../src/lib/types';

type JourneyInput = Pick<Snapshot, 'today' | 'demo' | 'sources' | 'matches' | 'flags' | 'outreach'>;
const expectedSources: Source[] = ['online', 'event', 'auction', 'check'];
const source = (name: Source, importedAt = '2026-11-09T12:00:00Z'): SourceFreshness => ({ source: name, file: `${name}.csv`, importedAt, throughDate: '2024-01-01' });
const allSources = (importedAt?: string) => expectedSources.map(name => source(name, importedAt));
const match = (id: string, status: MatchCandidate['status'] = 'pending'): MatchCandidate => ({ id, status, name: id, recordIds: [`${id}-a`, `${id}-b`], donorIds: [`${id}-1`, `${id}-2`], confidence: 'High', reason: 'Same contact details', evidence: [], assessedBy: 'rules' });
const flag = (id: string, expectedDate = '2026-11-02'): LateFlag => ({ donorId: id, name: id, pattern: 'monthly', expectedDate, daysLate: 7, lastGiftDate: '2026-10-02', lastAmountCents: 5000, usualAmountCents: 5000, annualValueCents: 60000, reason: 'Gift missing from records', firstGiftYear: 2024, program: '' });
const outreach = (donorId: string, status: Outreach['status'], at = '2026-11-09T12:00:00Z', snoozedUntil: string | null = null): Outreach => ({ donorId, status, at, snoozedUntil, result: '' });
function input(changes: Partial<JourneyInput> = {}): JourneyInput {
  return { today: '2026-11-09', demo: false, sources: [], matches: [], flags: [], outreach: [], ...changes };
}

test('an empty workspace starts with upload without hiding outstanding work counts', () => {
  const result = buildJourney(input({ matches: [match('rosa')], flags: [flag('ana')] }));
  assert.equal(result.next.task, 'upload'); assert.equal(result.next.view, 'home');
  assert.equal(result.sourceCount, 0); assert.equal(result.currentSourceCount, 0);
  assert.deepEqual(result.missingSources, expectedSources); assert.deepEqual(result.outdatedSources, []);
  assert.equal(result.filesReady, false); assert.equal(result.sampleLoaded, false);
  assert.equal(result.pendingDuplicates, 1); assert.equal(result.callCount, 1);
});

test('partial uploads count distinct expected sources and report missing ones', () => {
  const result = buildJourney(input({ sources: [source('online'), source('online'), source('check')] }));
  assert.equal(result.sourceCount, 2); assert.equal(result.currentSourceCount, 2);
  assert.deepEqual(result.missingSources, ['event', 'auction']); assert.equal(result.next.task, 'upload');
  assert.equal(result.filesReady, false);
});

test('all four sample files are ready despite a fixed historical demo date', () => {
  const result = buildJourney(input({ demo: true, today: '2026-11-07', sources: allSources('2027-01-04T12:00:00Z'), matches: [match('rosa')] }));
  assert.equal(result.sourceCount, 4); assert.equal(result.currentSourceCount, 0);
  assert.equal(result.filesReady, true); assert.equal(result.sampleLoaded, true);
  assert.deepEqual(result.outdatedSources, []); assert.equal(result.next.task, 'duplicates');
  assert.match(result.next.description, /sample files are already loaded/);
});

test('an incomplete sample workspace still starts with its missing files', () => {
  const result = buildJourney(input({ demo: true, sources: allSources().slice(0, 3), matches: [match('rosa')] }));
  assert.equal(result.filesReady, false); assert.equal(result.sampleLoaded, false); assert.equal(result.next.task, 'upload');
  assert.deepEqual(result.missingSources, ['check']);
});

test('pending duplicates outrank calls and approved or rejected groups are excluded from badges', () => {
  const result = buildJourney(input({ sources: allSources(), matches: [match('one'), match('two'), match('later', 'skipped'), match('approved', 'approved'), match('rejected', 'rejected')], flags: [flag('ana')] }));
  assert.equal(result.pendingDuplicates, 2); assert.equal(result.savedDuplicates, 1); assert.equal(result.duplicateCount, 3);
  assert.equal(result.next.task, 'duplicates'); assert.equal(result.next.view, 'matches');
  assert.equal(result.next.title, 'Review 2 possible duplicate groups'); assert.equal(result.next.button, 'Review duplicates');
});

test('actionable calls come before saved duplicate groups and saved groups remain visible afterward', () => {
  const snapshot = input({ sources: allSources(), matches: [match('later', 'skipped')], flags: [flag('ana')] });
  const first = buildJourney(snapshot);
  assert.equal(first.next.task, 'calls'); assert.equal(first.callCount, 1); assert.equal(first.duplicateCount, 1);
  const later = buildJourney({ ...snapshot, outreach: [outreach('ana', 'Called')] });
  assert.equal(later.next.task, 'saved'); assert.equal(later.next.view, 'matches'); assert.equal(later.savedDuplicates, 1);
});

test('called, emailed, left-message and active snooze episodes do not inflate the call badge', () => {
  const result = buildJourney(input({ sources: allSources(), flags: ['called', 'emailed', 'message', 'snoozed', 'expired', 'waiting'].map(id => flag(id)), outreach: [outreach('called', 'Called'), outreach('emailed', 'Emailed'), outreach('message', 'Left message'), outreach('snoozed', 'Snoozed', undefined, '2026-11-10'), outreach('expired', 'Snoozed', undefined, '2026-11-09')] }));
  assert.equal(result.callCount, 2); assert.equal(result.next.task, 'calls'); assert.equal(result.next.title, 'Contact 2 donors');
});

test('a later missed-gift episode returns to the call list after an earlier contact', () => {
  const result = buildJourney(input({ today: '2026-12-07', sources: allSources('2026-12-07T14:00:00Z'), flags: [flag('ana', '2026-12-02')], outreach: [outreach('ana', 'Called', '2026-11-09T12:00:00Z')] }));
  assert.equal(result.callCount, 1); assert.equal(result.next.task, 'calls');
});

test('Monday freshness uses Eastern dates rather than the UTC date', () => {
  const sundayEastern = buildJourney(input({ sources: allSources('2026-11-09T04:59:59Z') }));
  assert.equal(sundayEastern.currentSourceCount, 0); assert.deepEqual(sundayEastern.outdatedSources, expectedSources);
  assert.equal(sundayEastern.next.task, 'upload');
  const mondayEastern = buildJourney(input({ sources: allSources('2026-11-09T05:00:00Z') }));
  assert.equal(mondayEastern.currentSourceCount, 4); assert.equal(mondayEastern.filesReady, true);
  assert.equal(mondayEastern.next.task, 'done');
  const sundayWeekEnd = buildJourney(input({ today: '2026-11-08', sources: allSources('2026-11-02T05:00:00Z') }));
  assert.equal(sundayWeekEnd.filesReady, true);
});

test('Eastern week boundaries respect daylight saving time', () => {
  const before = buildJourney(input({ today: '2026-03-09', sources: allSources('2026-03-09T03:59:59Z') }));
  const after = buildJourney(input({ today: '2026-03-09', sources: allSources('2026-03-09T04:00:00Z') }));
  assert.equal(before.filesReady, false); assert.equal(after.filesReady, true);
});

test('outdated sources recommend upload but retain available duplicate and follow-up counts', () => {
  const result = buildJourney(input({ sources: [source('online'), source('event'), source('auction', '2026-11-02T12:00:00Z'), source('check', '2026-10-01T12:00:00Z')], matches: [match('rosa')], flags: [flag('ana')] }));
  assert.equal(result.sourceCount, 4); assert.equal(result.currentSourceCount, 2);
  assert.deepEqual(result.missingSources, []); assert.deepEqual(result.outdatedSources, ['auction', 'check']);
  assert.equal(result.next.task, 'upload'); assert.equal(result.pendingDuplicates, 1); assert.equal(result.callCount, 1);
});

test('invalid and future import timestamps cannot make live files current', () => {
  for (const importedAt of ['not-a-date', '2026-11-10T12:00:00Z', '2026-02-30T12:00:00Z', '2026-11-09', '2026-11-09T99:00:00Z', '2026-11-09T12:00:00']) {
    const result = buildJourney(input({ sources: allSources(importedAt) }));
    assert.equal(result.filesReady, false, importedAt); assert.equal(result.currentSourceCount, 0, importedAt);
    assert.deepEqual(result.outdatedSources, expectedSources, importedAt);
  }
  const stillTodayEastern = buildJourney(input({ sources: allSources('2026-11-10T03:00:00Z') }));
  assert.equal(stillTodayEastern.filesReady, true);
});

test('a valid current import remains usable when duplicate source entries include bad timestamps', () => {
  const result = buildJourney(input({ sources: [...allSources(), source('online', 'future-invalid')] }));
  assert.equal(result.sourceCount, 4); assert.equal(result.currentSourceCount, 4); assert.equal(result.filesReady, true);
});

test('upload freshness does not infer export completeness from a gift date', () => {
  const oldHistory = buildJourney(input({ sources: allSources(), flags: [flag('ana')] }));
  const futureHistory = buildJourney(input({ sources: allSources().map(item => ({ ...item, throughDate: '2099-01-01' })), flags: [flag('ana')] }));
  assert.deepEqual(oldHistory, futureHistory); assert.equal(oldHistory.next.task, 'calls');
  assert.match(oldHistory.next.description, /uploaded records/);
});

test('a clear review reaches done without mutating its input', () => {
  const snapshot = input({ sources: allSources(), matches: [match('approved', 'approved')], flags: [flag('ana')], outreach: [outreach('ana', 'Called')] });
  const original = structuredClone(snapshot);
  const first = buildJourney(snapshot), second = buildJourney(snapshot);
  assert.equal(first.next.task, 'done'); assert.equal(first.next.view, 'donors');
  assert.equal(first.duplicateCount, 0); assert.equal(first.callCount, 0);
  assert.deepEqual(first, second); assert.deepEqual(snapshot, original);
});
