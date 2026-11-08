import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from '../src/lib/http';
import { runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-fuzz-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;

/** Every call must either succeed or fail with a 4xx that tells the model what to fix. Nothing else is acceptable. */
async function attempt(name: string, args: unknown) {
  const data = snapshot();
  try { return { ok: true as const, value: await runRealtimeTool({ name, arguments: args }, data) }; }
  catch (error) {
    assert.ok(error instanceof HttpError, `${name} ${JSON.stringify(args)} threw a non-HTTP error: ${String(error)}`);
    assert.ok(error.status >= 400 && error.status < 500, `${name} ${JSON.stringify(args)} failed with ${error.status}`);
    assert.ok(error.message.length > 20, 'the failure explains itself');
    return { ok: false as const, status: error.status, message: error.message };
  }
}

test('get_donor_context survives every argument shape a model is likely to send', async () => {
  const data = snapshot();
  const jose = data.donors.find(donor => donor.name === 'José Benítez')!;
  const shapes: [unknown, string][] = [
    [{ view: 'top' }, 'donors'], [{ view: 'top', query: null, year: null }, 'donors'], [{ view: 'top', query: { question: 'best donor' } }, 'donors'], [{ view: 'top', year: '2026' }, 'donors'],
    [{ view: 'biggest donors' }, 'donors'], [{ view: 'Top' }, 'donors'], [{ view: 'late' }, 'calls'], [{ view: 'lapsed donors' }, 'calls'], [{ view: 'overview' }, 'home'], [{ view: 'summary' }, 'home'],
    [{ view: 'matches' }, 'matches'], [{ view: 'duplicates' }, 'matches'], [{ view: 'gala' }, 'donors'], [{ view: 'received', query: 'this month' }, 'donors'], [{ view: 'who has paid', query: ['last', '30 days'] }, 'donors'],
    [{ view: 'events' }, 'events'], [{ view: 'donor', query: jose.name }, 'donors'], [{ view: 'donor', query: jose.id }, 'donors'], [{ view: 'donor', query: { name: 'Benítez' } }, 'donors'], [{ view: 'find', query: 'Rosa' }, 'donors'],
  ];
  for (const [args, view] of shapes) {
    const outcome = await attempt('get_donor_context', args);
    assert.ok(outcome.ok, `${JSON.stringify(args)} → ${outcome.ok ? '' : outcome.message}`);
    assert.equal(outcome.value.result?.view, view, JSON.stringify(args));
    assert.ok(!JSON.stringify(outcome.value.output).includes('@example.org'), 'no emails to the model');
  }
  for (const args of [{ view: 'nonsense' }, {}, { view: 'donor', query: 'x'.repeat(500) }, null, 'top', 42]) {
    const outcome = await attempt('get_donor_context', args);
    assert.equal(outcome.ok, false, JSON.stringify(args));
  }
});

test('open_page accepts page synonyms and rejects the unknown with guidance', async () => {
  for (const [page, view] of [['calls', 'calls'], ['Calls this week', 'calls'], ['follow-ups', 'calls'], ['duplicates', 'matches'], ['the duplicate review', 'matches'], ['start', 'home'], ['home', 'home'], ['donors', 'donors'], ['all donors', 'donors'], ['events', 'events'], ['sign-up lists', 'events']] as const) {
    const outcome = await attempt('open_page', { page });
    assert.ok(outcome.ok && outcome.value.result?.view === view, `${page} → ${outcome.ok ? outcome.value.result?.view : outcome.message}`);
  }
  assert.equal((await attempt('open_page', { page: 'settings' })).ok, false);
  assert.equal((await attempt('open_page', {})).ok, false);
});

test('draft_note tolerates missing flags, odd formats, a name in donorId, and both donor and audience', async () => {
  const data = snapshot();
  const jose = data.donors.find(donor => donor.name === 'José Benítez')!;
  const good: unknown[] = [
    { donorId: jose.id, audience: null, language: 'en', giveMiami: false, format: 'email', purpose: 'thank him' },
    { donorId: jose.id },
    { donorId: jose.id, format: 'message', purpose: null, giveMiami: 'no', language: 'Spanish' },
    { donorId: jose.id, format: 'a short letter', purpose: { text: 'thank him' } },
    { donorId: jose.id, audience: 'our top donors', language: 'en', giveMiami: false, format: 'note', purpose: '' },
    { donorId: null, audience: 'lapsed donors', language: 'en', giveMiami: true, format: 'email', purpose: 'Give Miami Day' },
    { audience: 'the board', format: 'call script' },
    { donorId: null, audience: 'gala guests', language: 'es', giveMiami: false, format: 'text message', purpose: 'thank them' },
  ];
  for (const args of good) {
    const outcome = await attempt('draft_note', args);
    assert.ok(outcome.ok, `${JSON.stringify(args)} → ${outcome.ok ? '' : outcome.message}`);
    assert.ok((outcome.value.result?.note ?? '').length > 20, 'a note is on screen');
    assert.equal(outcome.value.output.sent, false);
  }
  const unique = data.donors.find(donor => data.donors.filter(other => other.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === donor.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()).length === 1)!;
  const named = await attempt('draft_note', { donorId: unique.name });
  assert.ok(named.ok && named.value.result?.donorId === unique.id, `a unique name typed into donorId resolves to the donor (${unique.name}): ${named.ok ? '' : named.message}`);
  const unknown = await attempt('draft_note', { donorId: 'Nobody Real' });
  assert.ok(!unknown.ok && unknown.status === 404 && /get_donor_context/.test(unknown.message));
  const nobody = await attempt('draft_note', { donorId: null, audience: null });
  assert.ok(!nobody.ok && /who the message is for/i.test(nobody.message));
  const ambiguous = await attempt('draft_note', { donorId: 'Rosa Delgado' });
  assert.ok(!ambiguous.ok || ambiguous.value.result?.donorId, 'duplicate names never pick silently');
});

test('propose_change prepares review cards from tolerant arguments and never executes anything', async () => {
  const data = snapshot();
  const jose = data.donors.find(donor => donor.name === 'José Benítez')!;
  const pending = data.matches.find(match => match.status === 'pending')!;
  const before = JSON.stringify(snapshot().donors.map(donor => donor.records.length));
  const good: unknown[] = [
    { action: 'contact', donorId: jose.id, candidateId: null, status: 'Called', resultNote: 'Left a voicemail' },
    { action: 'contact', donorId: jose.id, status: 'called', resultNote: null },
    { action: 'contact', donorId: jose.name, status: 'left a voicemail' },
    { action: 'log outreach', donorId: jose.id, status: 'snooze' },
    { action: 'merge', candidateId: pending.id, donorId: null, status: null, resultNote: '' },
    { action: 'merge', candidateId: pending.id },
    { action: 'combine', donorId: pending.donorIds[0] },
    { action: 'bulk_merge', donorId: null, candidateId: null, status: null, resultNote: '' },
    { action: 'merge all high confidence' },
  ];
  for (const args of good) {
    const outcome = await attempt('propose_change', args);
    assert.ok(outcome.ok, `${JSON.stringify(args)} → ${outcome.ok ? '' : outcome.message}`);
    assert.ok(outcome.value.result?.approval, 'a review card, not an action');
    assert.equal(outcome.value.output.changesMade, false);
  }
  for (const args of [{ action: 'contact', donorId: jose.id }, { action: 'merge' }, { action: 'delete', donorId: jose.id }, { action: 'contact', donorId: 'Nobody Real', status: 'Called' }, {}]) {
    const outcome = await attempt('propose_change', args);
    assert.equal(outcome.ok, false, JSON.stringify(args));
  }
  assert.equal(JSON.stringify(snapshot().donors.map(donor => donor.records.length)), before, 'nothing merged');
});

test('create_event accepts a spoken date and missing host, and explains an unreadable date', async () => {
  for (const args of [{ name: 'Fuzz Gala', host: null, date: '2026-12-20' }, { name: 'Fuzz Dinner', date: 'December 21' }, { name: 'Fuzz Brunch', host: 'Someone', date: 'Dec 22nd, 2026' }, { name: { text: 'Fuzz Walk' }, date: '12/23' }]) {
    const outcome = await attempt('create_event', args);
    assert.ok(outcome.ok && outcome.value.result?.view === 'events' && outcome.value.result?.eventId, `${JSON.stringify(args)} → ${outcome.ok ? '' : outcome.message}`);
  }
  const bad = await attempt('create_event', { name: 'Fuzz', date: 'sometime next spring' });
  assert.ok(!bad.ok && /day and month/.test(bad.message));
  assert.equal((await attempt('create_event', { name: 'X', date: '2026-12-01' })).ok, false);
  assert.equal((await attempt('create_event', { date: '2026-12-01' })).ok, false);
  assert.equal((await attempt('not_a_tool', {})).ok, false);
});

test('lookups match on words, so spoken names find groups and events', async () => {
  const data = snapshot();
  const group = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'matches', query: 'Rosa Delgado' } }, data);
  assert.ok((group.output.count as number) >= 1, 'the Delgado group is found by a member name');
  assert.ok((group.output.groups as { candidateId: string }[])[0].candidateId);
  const gala = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'events', query: 'fall gala' } }, data);
  assert.equal((gala.output.events as { name: string }[])[0]?.name, 'Fall Harvest Gala');
  const none = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'events', query: 'spring picnic' } }, data);
  assert.equal(none.output.count, 0);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
