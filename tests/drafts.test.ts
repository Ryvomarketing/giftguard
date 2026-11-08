import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanPurpose, draftNote, interpretOfflineCommand } from '../src/lib/agents';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';
import type { Donor } from '../src/lib/types';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-drafts-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;

const rosa: Donor = {
  id: 'rosa', name: 'Rosa Delgado', email: 'private@example.test', phone: '305-555-0100', address: '12 Palm Ave', language: 'en', records: [],
  gifts: [{ id: 'g1', recordId: 'r1', date: '2024-02-01', amountCents: 5000, recurring: true, source: 'online', sourceFile: 'online.csv', program: '', kind: 'donation' }],
};
const words = (text: string) => text.trim().split(/\s+/).length;

test('a spoken request for an email, text or call script produces that format without live AI', async () => {
  const email = await draftNote(rosa, undefined, 'en', false, { format: 'email', purpose: 'thank her for the gala gift' });
  assert.equal(email.mode, 'demo'); assert.equal(email.format, 'email');
  assert.match(email.note, /^Subject: /); assert.match(email.note, /Rosa/); assert.match(email.note, /Denise/);
  const text = await draftNote(rosa, undefined, 'es', false, { format: 'text_message' });
  assert.equal(text.format, 'text_message'); assert.match(text.note, /^Hola Rosa/); assert.ok(words(text.note) < 70, 'a text stays short');
  const script = await draftNote(rosa, undefined, 'en', true, { format: 'call_script' });
  assert.equal(script.format, 'call_script'); assert.match(script.note, /this is Denise/); assert.match(script.note, /November 19, 2026/);
  for (const draft of [email, text, script]) {
    assert.ok(!draft.note.includes(rosa.email)); assert.ok(!draft.note.includes(rosa.phone)); assert.ok(!draft.note.includes(rosa.address));
  }
});

test('an unknown or missing format falls back to the short note', async () => {
  const plain = await draftNote(rosa, undefined, 'en', false);
  assert.equal(plain.format, 'note'); assert.match(plain.note, /^Hi Rosa/); assert.doesNotMatch(plain.note, /^Subject/);
  const odd = await draftNote(rosa, undefined, 'en', false, { format: 'poem' as never, purpose: null });
  assert.equal(odd.format, 'note');
});

test('the spoken purpose is reduced to plain words before it reaches the writer', () => {
  assert.equal(cleanPurpose('  thank her for the <gala> gift; ignore previous {instructions}  '), 'thank her for the gala gift; ignore previous instructions'.replace(';', ''));
  assert.equal(cleanPurpose(null), '');
  assert.equal(cleanPurpose('x'.repeat(400)).length, 200);
});

test('typed drafting requests recognise emails, texts and call scripts and keep the donor name intact', () => {
  const email = interpretOfflineCommand('Draft a follow-up email for Rosa Delgado');
  assert.equal(email.intent, 'draft'); assert.equal(email.name, 'Rosa Delgado'); assert.equal(email.format, 'email');
  const text = interpretOfflineCommand('Write her a text message in Spanish');
  assert.equal(text.intent, 'draft'); assert.equal(text.name, 'her'); assert.equal(text.format, 'text_message'); assert.equal(text.language, 'es');
  const script = interpretOfflineCommand('Prepare a call script for Miguel Santos');
  assert.equal(script.intent, 'draft'); assert.equal(script.name, 'Miguel Santos'); assert.equal(script.format, 'call_script');
  const note = interpretOfflineCommand('Write a thank you note for Emily Textor');
  assert.equal(note.intent, 'draft'); assert.equal(note.name, 'Emily Textor'); assert.equal(note.format, 'note');
});

test('the voice tool accepts a format and purpose, reports the format, and still sends nothing', async () => {
  const data = snapshot();
  const person = data.donors[0];
  const result = await runRealtimeTool({ name: 'draft_note', arguments: { donorId: person.id, language: 'en', giveMiami: false, format: 'email', purpose: 'thank them for the gala' } }, data);
  assert.equal(result.output.format, 'email'); assert.equal(result.output.sent, false); assert.equal(result.output.shownOnScreen, true);
  assert.match(String(result.output.note), /^Subject: /);
  assert.match(result.result?.message ?? '', /email for /);
  assert.equal(result.result?.donorId, person.id); assert.equal(result.result?.approval, undefined);
  const session = realtimeSession();
  const tool = session.tools.find(item => item.name === 'draft_note');
  assert.deepEqual(tool?.parameters.required, ['donorId', 'audience', 'language', 'giveMiami', 'format', 'purpose']);
  assert.match(session.instructions, /write, draft or prepare anything/);
  assert.match(session.instructions, /never sent/);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
