import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { draftGeneral, handleCommand, interpretOfflineCommand } from '../src/lib/agents';
import { HttpError } from '../src/lib/http';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-general-drafts-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;
const words = (text: string) => text.trim().split(/\s+/).length;

test('a draft for a group of people works without a donor and never names an individual', async () => {
  const email = await draftGeneral('our lapsed donors', 'en', true, { format: 'email', purpose: 'invite them to give on Give Miami Day' });
  assert.equal(email.mode, 'demo'); assert.equal(email.format, 'email');
  assert.match(email.note, /^Subject: /); assert.match(email.note, /Denise/); assert.match(email.note, /November 19, 2026/);
  assert.doesNotMatch(email.note, /Rosa|Miguel|Elena/);
  const text = await draftGeneral('everyone who came to the gala', 'es', false, { format: 'text_message' });
  assert.equal(text.format, 'text_message'); assert.match(text.note, /Denise/); assert.ok(words(text.note) < 70);
  assert.doesNotMatch(text.note, /19 de noviembre/);
  const script = await draftGeneral('the board', 'en', false, { format: 'call_script' });
  assert.equal(script.format, 'call_script'); assert.match(script.note, /this is Denise/);
  const note = await draftGeneral('<script>alert(1)</script> volunteers', 'en', false);
  assert.equal(note.format, 'note'); assert.doesNotMatch(note.note, /[<>]/);
});

test('typed requests for a group become a general draft, while a named person still gets a personal one', () => {
  const group = interpretOfflineCommand('Draft a Give Miami Day email to our lapsed donors');
  assert.equal(group.intent, 'draft'); assert.equal(group.name, null); assert.equal(group.audience, 'our lapsed donors');
  assert.equal(group.format, 'email'); assert.equal(group.giveMiami, true);
  const gala = interpretOfflineCommand('Write a thank you note to everyone who came to the gala');
  assert.equal(gala.intent, 'draft'); assert.equal(gala.name, null); assert.equal(gala.audience, 'everyone who came to the gala'); assert.equal(gala.format, 'note');
  const board = interpretOfflineCommand('Prepare a text message for the board in Spanish');
  assert.equal(board.intent, 'draft'); assert.equal(board.audience, 'the board'); assert.equal(board.format, 'text_message'); assert.equal(board.language, 'es');
  const person = interpretOfflineCommand('Draft a follow-up email for Rosa Delgado');
  assert.equal(person.intent, 'draft'); assert.equal(person.name, 'Rosa Delgado'); assert.equal(person.audience, null);
});

test('the typed assistant returns a general draft on screen without selecting a donor or proposing a change', async () => {
  const result = await handleCommand('Draft a Give Miami Day email to our lapsed donors', snapshot());
  assert.ok(result.note); assert.match(result.note, /^Subject: /);
  assert.equal(result.donorId, undefined); assert.equal(result.approval, undefined); assert.equal(result.mode, 'demo');
  assert.match(result.message, /email for our lapsed donors/); assert.match(result.message, /nothing is sent/i);
});

test('the voice tool drafts for a described group when no donor is chosen, and rejects an empty target', async () => {
  const data = snapshot();
  const result = await runRealtimeTool({ name: 'draft_note', arguments: { donorId: null, audience: 'our monthly supporters', language: 'en', giveMiami: false, format: 'email', purpose: 'thank them for a strong year' } }, data);
  assert.equal(result.result?.donorId, undefined); assert.equal(result.result?.approval, undefined);
  assert.match(result.result?.note ?? '', /^Subject: /);
  assert.equal(result.output.audience, 'our monthly supporters'); assert.equal(result.output.sent, false); assert.equal(result.output.drafting, 'template');
  await assert.rejects(runRealtimeTool({ name: 'draft_note', arguments: { donorId: null, audience: null, language: 'en', giveMiami: false, format: 'note', purpose: '' } }, data), (error: unknown) => error instanceof HttpError && error.status === 400);
  const both = await runRealtimeTool({ name: 'draft_note', arguments: { donorId: data.donors[0].id, audience: 'everyone', language: 'en', giveMiami: false, format: 'note', purpose: '' } }, data);
  assert.equal(both.result?.donorId, data.donors[0].id, 'when both are given the named donor wins and no group message is produced');
  assert.equal(both.output.individualsNamed, undefined);
  const session = realtimeSession();
  const tool = session.tools.find(item => item.name === 'draft_note');
  assert.ok(tool?.parameters.required.includes('audience'));
  assert.match(session.instructions, /group/i);
  assert.ok(typeof session.audio.input.transcription?.model === 'string', 'spoken requests are transcribed for the on-screen log');
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
