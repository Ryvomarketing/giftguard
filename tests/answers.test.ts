import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receivedDonors, receivedWindow } from '../src/lib/answers';
import { executeCommandIntent, handleCommand, interpretOfflineCommand } from '../src/lib/agents';
import { toolActivity } from '../src/lib/agent-activity';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-answers-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;

const context = { today: '2026-11-07', sources: [{ source: 'online' as const, file: 'a.csv', importedAt: '2026-10-08T14:00:00Z', throughDate: '2026-10-07' }] };

test('period words become a dated window, defaulting to the current month', () => {
  assert.deepEqual(receivedWindow(null, context), { since: '2026-11-01', until: '2026-11-07', label: 'Gave in November 2026' });
  assert.equal(receivedWindow('who has paid this month', context).since, '2026-11-01');
  assert.deepEqual(receivedWindow('last 30 days', context), { since: '2026-10-08', until: '2026-11-07', label: 'Gave in the last 30 days' });
  assert.equal(receivedWindow('this week', context).since, '2026-10-31');
  assert.equal(receivedWindow('what came in since the last upload', context).since, '2026-10-08');
  assert.match(receivedWindow('since the last upload', context).label, /last upload \(Oct 8\)/);
  assert.deepEqual(receivedWindow('last month', context), { since: '2026-10-01', until: '2026-10-31', label: 'Gave in October 2026' });
  assert.equal(receivedWindow('this year', context).since, '2026-01-01');
  assert.equal(receivedWindow('since the last upload', { ...context, sources: [] }).since, '2026-11-01', 'no uploads falls back to this month');
});

test('recent givers are donations only, newest gift first, with the window total', () => {
  const data = snapshot();
  const window = receivedWindow('last 30 days', data);
  const found = receivedDonors(data, window);
  assert.ok(found.length > 0);
  for (let index = 1; index < found.length; index++) assert.ok(found[index - 1].latestDate >= found[index].latestDate);
  for (const item of found) {
    assert.ok(item.latestDate >= window.since && item.latestDate <= window.until);
    const expected = item.donor.gifts.filter(gift => gift.kind === 'donation' && gift.date >= window.since && gift.date <= window.until).reduce((sum, gift) => sum + gift.amountCents, 0);
    assert.equal(item.cents, expected); assert.ok(item.cents > 0);
  }
  const purchaseOnly = data.donors.filter(donor => donor.gifts.length && donor.gifts.every(gift => gift.kind === 'purchase'));
  for (const donor of purchaseOnly) assert.ok(!found.some(item => item.donor.id === donor.id), 'ticket buyers are not payers');
  assert.deepEqual(receivedDonors(data, { since: '1999-01-01', until: '1999-12-31', label: 'x' }), []);
});

test('typed "who has paid" answers with a filtered list and an answer bar, and "who has not paid" still goes to calls', async () => {
  const data = snapshot();
  const paid = interpretOfflineCommand('Who has paid this month?', data.today);
  assert.equal(paid.intent, 'received'); assert.match(paid.period ?? '', /this month/);
  assert.equal(interpretOfflineCommand('What came in since the last upload?', data.today).intent, 'received');
  assert.equal(interpretOfflineCommand('Which donors have given in the last 30 days?', data.today).intent, 'received');
  assert.equal(interpretOfflineCommand('Who has not paid?', data.today).intent, 'late');
  assert.equal(interpretOfflineCommand('Who is our biggest donor?', data.today).intent, 'top');
  const result = await executeCommandIntent({ ...paid, period: 'last 30 days' }, data, 'demo');
  assert.equal(result.view, 'donors'); assert.ok(result.donorIds && result.donorIds.length > 0);
  assert.equal(result.answer?.label, 'Gave in the last 30 days'); assert.equal(result.answer?.count, result.donorIds!.length); assert.ok((result.answer?.totalCents ?? 0) > 0);
  assert.match(result.message, /donors have given in the last 30 days/); assert.doesNotMatch(result.message, /@/);
  const none = await executeCommandIntent({ ...paid, period: 'last month' }, { ...data, donors: [] }, 'demo');
  assert.equal(none.answer?.count, 0); assert.match(none.message, /No donations/);
  const top = await handleCommand('Who is our biggest donor?', data);
  assert.equal(top.answer?.label, 'Top donors by donations'); assert.equal(top.answer?.count, top.donorIds?.length);
});

test('the voice tool has a received view that returns the same answer without contact details', async () => {
  const data = snapshot();
  const session = realtimeSession(data.today);
  assert.match(session.instructions, /view received/);
  assert.ok((session.tools.find(tool => tool.name === 'get_donor_context') as { parameters: { properties: { view: { enum: string[] } } } }).parameters.properties.view.enum.includes('received'));
  const result = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'received', query: 'last 30 days' } }, data);
  assert.equal(result.result?.view, 'donors'); assert.equal(result.result?.answer?.label, 'Gave in the last 30 days');
  assert.equal(result.output.count, result.result?.donorIds?.length); assert.equal(result.output.purchasesExcluded, true);
  const text = JSON.stringify(result.output);
  assert.ok(!text.includes('@example.org')); assert.ok(!text.includes('phone'));
  const activity = toolActivity('one', 'get_donor_context', { view: 'received' }, 'complete', result.result!);
  assert.deepEqual(activity?.targets, ['answer-bar', 'donor-list']); assert.equal(activity?.label, 'Recent gifts');
  assert.equal(toolActivity('two', 'get_donor_context', { view: 'received' }, 'working')?.label, 'Finding recent gifts');
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
