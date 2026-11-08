import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeCommandIntent, handleCommand, interpretOfflineCommand, topDonors } from '../src/lib/agents';
import { toolActivity } from '../src/lib/agent-activity';
import { HttpError } from '../src/lib/http';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-voice-navigation-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;

test('the voice agent has a page-opening tool that navigates without fetching donor facts', async () => {
  const session = realtimeSession();
  assert.ok(session.tools.some(item => item.name === 'open_page'));
  assert.match(session.instructions, /open_page/);
  const data = snapshot();
  const pages: [string, string][] = [['start', 'home'], ['duplicates', 'matches'], ['calls', 'calls'], ['donors', 'donors']];
  for (const [page, view] of pages) {
    const result = await runRealtimeTool({ name: 'open_page', arguments: { page } }, data);
    assert.equal(result.result?.view, view, `${page} opens ${view}`);
    assert.equal(result.result?.donorId, undefined); assert.equal(result.result?.approval, undefined);
    assert.equal(result.output.opened, page);
    const text = JSON.stringify(result.output);
    assert.ok(!text.includes('@example.org')); assert.ok(!text.includes('phone'));
  }
  const donors = await runRealtimeTool({ name: 'open_page', arguments: { page: 'donors' } }, data);
  assert.equal(donors.output.donorCount, data.donors.length);
  const calls = await runRealtimeTool({ name: 'open_page', arguments: { page: 'calls' } }, data);
  assert.equal(calls.output.followUps, 9);
  await assert.rejects(runRealtimeTool({ name: 'open_page', arguments: { page: 'settings' } }, data), (error: unknown) => error instanceof HttpError && error.status === 400);
});

test('the biggest donors are ranked by donations, excluding purchases, and shown in that order', async () => {
  const data = snapshot();
  const ranked = topDonors(data, 8);
  assert.equal(ranked.length, 8);
  for (let index = 1; index < ranked.length; index++) assert.ok(ranked[index - 1].donationCents >= ranked[index].donationCents);
  const expected = data.donors.map(donor => ({ id: donor.id, cents: donor.gifts.filter(gift => gift.kind === 'donation').reduce((sum, gift) => sum + gift.amountCents, 0) })).sort((a, b) => b.cents - a.cents)[0];
  assert.equal(ranked[0].donor.id, expected.id);
  const result = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'top', query: null } }, data);
  assert.equal(result.result?.view, 'donors');
  assert.deepEqual(result.result?.donorIds, ranked.map(item => item.donor.id));
  const first = (result.output.donors as { donorId: string; name: string; donations: string; rank: number }[])[0];
  assert.equal(first.donorId, expected.id); assert.equal(first.rank, 1); assert.match(first.donations, /^\$/);
  assert.equal(result.output.rankedBy, 'donations');
  const text = JSON.stringify(result.output);
  assert.ok(!text.includes('@example.org')); assert.ok(!text.includes('address'));
});

test('typed requests for the biggest donor and the donors page work without live AI', async () => {
  const biggest = interpretOfflineCommand('Who is our biggest donor?');
  assert.equal(biggest.intent, 'top');
  assert.equal(interpretOfflineCommand('Show me the top donors').intent, 'top');
  assert.equal(interpretOfflineCommand('Who has given the most?').intent, 'top');
  assert.equal(interpretOfflineCommand('Show me all donors').intent, 'donors');
  assert.equal(interpretOfflineCommand('Open the all donors page').intent, 'donors');
  assert.equal(interpretOfflineCommand('Show me the calls this week page').intent, 'late');
  assert.equal(interpretOfflineCommand('Show me the 9 donors to contact').intent, 'late');
  assert.equal(interpretOfflineCommand('Show me Rosa Delgado').intent, 'find');
  const data = snapshot();
  const result = await executeCommandIntent(biggest, data, 'demo');
  assert.equal(result.view, 'donors'); assert.ok(result.donorIds && result.donorIds.length > 0);
  assert.match(result.message, /biggest donor/i); assert.doesNotMatch(result.message, /@/);
  const page = await handleCommand('Show me all donors', data);
  assert.equal(page.view, 'donors'); assert.equal(page.donorIds, undefined); assert.equal(page.donorId, undefined);
});

test('page opening shows the navigation target then the opened list, never an approval card', () => {
  const working = toolActivity('one', 'open_page', { page: 'calls' }, 'working');
  assert.deepEqual(working?.targets, ['nav-calls']); assert.equal(working?.phase, 'working');
  const complete = toolActivity('one', 'open_page', { page: 'calls' }, 'complete', { message: 'Here is the call list.', view: 'calls', mode: 'ai' });
  assert.deepEqual(complete?.targets, ['follow-up-list']);
  assert.deepEqual(toolActivity('two', 'open_page', { page: 'donors' }, 'complete', { message: '', view: 'donors', mode: 'ai' })?.targets, ['donor-list']);
  assert.deepEqual(toolActivity('three', 'get_donor_context', { view: 'top' }, 'complete', { message: '', view: 'donors', mode: 'ai' })?.targets, ['donor-list']);
});

test('the ranking can be limited to one year, and this year / last year resolve against the workspace date', async () => {
  const data = snapshot();
  const year = Number(data.today.slice(0, 4));
  const ranked = topDonors(data, 8, year);
  assert.ok(ranked.length > 0);
  for (const item of ranked) {
    const expected = item.donor.gifts.filter(gift => gift.kind === 'donation' && gift.date.startsWith(String(year))).reduce((sum, gift) => sum + gift.amountCents, 0);
    assert.equal(item.donationCents, expected);
  }
  assert.deepEqual(topDonors(data, 8, 1999), []);
  const voice = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'top', query: null, year } }, data);
  assert.equal(voice.output.year, year);
  assert.deepEqual(voice.result?.donorIds, ranked.map(item => item.donor.id));
  const empty = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'top', query: null, year: 1999 } }, data);
  assert.equal((empty.output.donors as unknown[]).length, 0); assert.match(empty.result?.message ?? '', /1999/);
  const session = realtimeSession(data.today);
  assert.match(session.instructions, new RegExp(`Today is ${data.today}`));
  const thisYear = interpretOfflineCommand('Who is our biggest donor this year?', data.today);
  assert.equal(thisYear.intent, 'top'); assert.equal(thisYear.year, year);
  assert.equal(interpretOfflineCommand('Who gave the most last year?', data.today).year, year - 1);
  assert.equal(interpretOfflineCommand('Top donors in 2024', data.today).year, 2024);
  assert.equal(interpretOfflineCommand('Who is our biggest donor?', data.today).year, null);
  const result = await executeCommandIntent(thisYear, data, 'demo');
  assert.match(result.message, new RegExp(`in ${year}`)); assert.deepEqual(result.donorIds, ranked.map(item => item.donor.id));
  const none = await executeCommandIntent({ ...thisYear, year: 1999 }, data, 'demo');
  assert.match(none.message, /1999/); assert.equal(none.donorIds, undefined);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
