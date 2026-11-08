import assert from 'node:assert/strict';
import test from 'node:test';
import { executeCommandIntent, findDonors, interpretOfflineCommand, draftNote } from '../src/lib/agents';
import type { Action, Approval, Donor, Gift, Snapshot } from '../src/lib/types';

function gift(id: string, source: Gift['source'], date: string, kind: Gift['kind'] = 'donation'): Gift {
  return { id, recordId: 'r1', date, source, kind, amountCents: 5000, recurring: false, sourceFile: 'sample.csv', program: '' };
}
function donor(id: string, name: string, gifts: Gift[] = []): Donor {
  return { id, name, gifts, email: 'private@example.org', phone: '3055550100', address: '123 Private Street', language: 'en', records: [] };
}
function snapshot(): Snapshot {
  return { donors: [donor('rosa', 'Rosa Delgado'), donor('maria1', 'María Cruz'), donor('maria2', 'Maria Perez')], matches: [], flags: [], outreach: [], merges: [], sources: [], events: [], today: '2026-11-07', demo: true, aiAvailable: false, giftCount: 0, totalCents: 0 };
}
function proposals() {
  const actions: Action[] = [];
  const propose = (action: Action): Approval => {
    actions.push(action);
    return { id: 'proposal', title: 'Please review', description: 'Nothing changed', items: [], action, expiresAt: '2026-11-07T23:59:00Z' };
  };
  return { actions, propose };
}

test('ambiguous spoken names never select a donor for contact changes', async () => {
  const data = snapshot();
  const { actions, propose } = proposals();
  const result = await executeCommandIntent(interpretOfflineCommand('Mark Maria called'), data, 'demo', propose);
  assert.deepEqual(result.donorIds, ['maria1', 'maria2']);
  assert.equal(result.approval, undefined);
  assert.equal(actions.length, 0);
  assert.match(result.message, /Choose a donor/);
});

test('contact command creates only an approval proposal and leaves records unchanged', async () => {
  const data = snapshot();
  const original = structuredClone(data);
  const { actions, propose } = proposals();
  const result = await executeCommandIntent(interpretOfflineCommand('Mark Rosa Delgado called'), data, 'demo', propose);
  assert.deepEqual(actions, [{ type: 'contact', donorId: 'rosa', status: 'Called', result: '' }]);
  assert.equal(result.approval?.id, 'proposal');
  assert.deepEqual(data, original);
  assert.match(result.message, /Nothing has changed/);
});

test('bulk approval includes only pending high-confidence groups', async () => {
  const data = snapshot();
  data.matches = [
    { id: 'high', recordIds: ['1', '2'], donorIds: ['1', '2'], name: 'Rosa', confidence: 'High', reason: 'Same email', evidence: [], status: 'pending', assessedBy: 'rules' },
    { id: 'medium', recordIds: ['3', '4'], donorIds: ['3', '4'], name: 'Ana', confidence: 'Medium', reason: 'Similar name', evidence: [], status: 'pending', assessedBy: 'rules' },
    { id: 'rejected', recordIds: ['5', '6'], donorIds: ['5', '6'], name: 'Luis', confidence: 'High', reason: 'Shared phone', evidence: [], status: 'rejected', assessedBy: 'rules' },
  ];
  const { actions, propose } = proposals();
  await executeCommandIntent(interpretOfflineCommand('Approve all high-confidence matches'), data, 'demo', propose);
  assert.deepEqual(actions, [{ type: 'merge', candidateIds: ['high'] }]);
  assert.equal(data.matches[0].status, 'pending');
});

test('negated and conditional commands do not propose changes', async () => {
  for (const request of ['Do not approve all high-confidence matches', "Don't mark Rosa Delgado called", 'If I approve all high-confidence matches, what happens?', 'Approve all matches']) {
    const { actions, propose } = proposals();
    await executeCommandIntent(interpretOfflineCommand(request), snapshot(), 'demo', propose);
    assert.equal(actions.length, 0, request);
  }
});

test('accent-insensitive lookup supports a full name but does not choose between same first names', () => {
  assert.equal(findDonors('Maria Cruz', snapshot())[0]?.id, 'maria1');
  assert.equal(findDonors('Maria', snapshot()).length, 2);
  assert.equal(findDonors('Unknown Person', snapshot()).length, 0);
});

test('gala question excludes purchases and donors who have given later', async () => {
  const data = snapshot();
  data.donors = [
    donor('gala', 'Gala Donor', [gift('1', 'auction', '2026-01-10')]),
    donor('purchase', 'Ticket Buyer', [gift('2', 'auction', '2026-01-10', 'purchase')]),
    donor('later', 'Later Donor', [gift('3', 'auction', '2026-01-10'), gift('4', 'online', '2026-02-01')]),
  ];
  const result = await executeCommandIntent(interpretOfflineCommand("Who gave at the gala but hasn't given since?"), data, 'demo');
  assert.deepEqual(result.donorIds, ['gala']);
  assert.match(result.message, /uploaded files/);
});

test('fallback notes are grounded, bounded, and do not disclose contact information', async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    for (const language of ['en', 'es'] as const) for (const giveMiami of [false, true]) {
      const person = donor('rosa', 'Rosa Delgado', [gift('1', 'check', '2024-12-01')]);
      const result = await draftNote(person, undefined, language, giveMiami);
      assert.equal(result.mode, 'demo');
      assert.match(result.note, /Rosa/);
      assert.match(result.note, /2024/);
      assert.ok(!result.note.includes(person.email));
      assert.ok(!result.note.includes(person.address));
      assert.ok(!result.note.includes(person.phone));
      assert.equal(result.note.includes('November 19') || result.note.includes('19 de noviembre'), giveMiami);
      const words = result.note.trim().split(/\s+/).length;
      assert.ok(words >= 60 && words <= 90, `Expected 60–90 words, got ${words} for ${language}, Give Miami ${giveMiami}`);
    }
  } finally { if (original !== undefined) process.env.OPENAI_API_KEY = original; }
});

test('no matching donor produces an explicit empty result, not invented history', async () => {
  const result = await executeCommandIntent(interpretOfflineCommand('Show me Unlisted Person'), snapshot(), 'demo');
  assert.deepEqual(result.donorIds, []);
  assert.equal(result.donorId, undefined);
  assert.match(result.message, /could not find/);
});
