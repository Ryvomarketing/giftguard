import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { POST as connect } from '../src/app/api/realtime/route';
import { POST as tool } from '../src/app/api/realtime/tool/route';
import { makeSession } from '../src/lib/http';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';
import { getStore } from '../src/lib/store';
import type { Donor, Snapshot } from '../src/lib/types';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-realtime-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;
const cookie = `giftguard-session=${makeSession()}`;
const offer = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
const answer = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
function request(body: string, options: { authenticated?: boolean; origin?: string; contentType?: string; signal?: AbortSignal; path?: string } = {}) {
  return new NextRequest(`http://localhost:3000/api/${options.path || 'realtime'}`, { method: 'POST', headers: {
    ...(options.authenticated === false ? {} : { cookie }),
    origin: options.origin ?? 'http://localhost:3000',
    'content-type': options.contentType ?? 'application/sdp',
  }, body, signal: options.signal });
}
function toolRequest(input: unknown, options: { authenticated?: boolean; origin?: string } = {}) {
  return request(JSON.stringify(input), { ...options, path: 'realtime/tool', contentType: 'application/json' });
}
async function withProvider(mock: typeof fetch, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  process.env.OPENAI_API_KEY = 'test-only-provider-credential';
  try { await run(); } finally { globalThis.fetch = originalFetch; delete process.env.OPENAI_API_KEY; }
}

test('live session uses bidirectional audio, interruptible VAD, and exactly four safe tools', () => {
  const session = realtimeSession();
  assert.equal(session.type, 'realtime');
  assert.equal(session.model, 'gpt-realtime-2.1-mini');
  assert.deepEqual(session.output_modalities, ['audio']);
  assert.deepEqual(session.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: true });
  assert.equal(session.audio.output.voice, 'marin');
  assert.deepEqual(session.tools.map(item => item.name), ['get_donor_context', 'open_page', 'draft_note', 'propose_change']);
  assert.match(session.instructions, /Spoken yes.*never permission/);
  assert.equal('client_secret' in session, false);
  assert.equal('api_key' in session, false);
});

test('SDP handshake requires a signed-in same-origin request and actual bounded SDP', async () => {
  assert.equal((await connect(request(offer, { authenticated: false }))).status, 401);
  assert.equal((await connect(request(offer, { origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await connect(request(offer, { contentType: 'application/json' }))).status, 415);
  assert.equal((await connect(request(''))).status, 400);
  assert.equal((await connect(request('v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'))).status, 400);
  // No Content-Length is supplied. The server must count the stream itself.
  assert.equal((await connect(request(offer + 'é'.repeat(33_000)))).status, 413);
  assert.equal((await connect(request(offer))).status, 503);
});

test('unified SDP exchange keeps the standard credential on the server', async () => {
  let providerCalls = 0;
  await withProvider(async (url, options) => {
    providerCalls++;
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-only-provider-credential');
    assert.ok(options?.body instanceof FormData);
    assert.equal(options.body.get('sdp'), offer);
    const session = JSON.parse(String(options.body.get('session')));
    assert.equal(session.type, 'realtime');
    assert.equal(session.audio.input.turn_detection.interrupt_response, true);
    assert.equal(JSON.stringify(session).includes('test-only-provider-credential'), false);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(answer, { status: 201, headers: { 'Content-Type': 'application/sdp', 'Location': 'https://provider.example/private-call-id' } });
  }, async () => {
    const response = await connect(request(offer));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/sdp');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('authorization'), null);
    assert.equal(await response.text(), answer);
  });
  assert.equal(providerCalls, 1);
});

test('provider failures and malformed answers cannot leak provider bodies or credentials', async () => {
  for (const provider of [
    async () => new Response('Bearer test-only-provider-credential: internal provider failure', { status: 401 }),
    async () => new Response('{"client_secret":"sensitive-provider-response"}', { status: 200 }),
    async () => { throw new TypeError('test-only-provider-credential internal network detail'); },
  ]) {
    await withProvider(provider, async () => {
      const response = await connect(request(offer));
      assert.ok([502, 503].includes(response.status));
      const result = await response.text();
      assert.ok(!result.includes('test-only-provider-credential'));
      assert.ok(!result.includes('sensitive-provider-response'));
      assert.ok(!result.includes('internal'));
    });
  }
});

test('canceling the browser handshake aborts the upstream request', async () => {
  const controller = new AbortController();
  let sawAbort = false;
  await withProvider(async (_url, options) => {
    assert.ok(options?.signal);
    controller.abort();
    sawAbort = options.signal.aborted;
    throw new DOMException('Cancelled', 'AbortError');
  }, async () => {
    const response = await connect(request(offer, { signal: controller.signal }));
    assert.equal(response.status, 503);
  });
  assert.equal(sawAbort, true);
});

test('voice tools enforce authentication and reject arbitrary actions or approval execution', async () => {
  const overview = { name: 'get_donor_context', arguments: { view: 'overview', query: null } };
  assert.equal((await tool(toolRequest(overview, { authenticated: false }))).status, 401);
  assert.equal((await tool(toolRequest(overview, { origin: 'https://attacker.example' }))).status, 403);
  for (const input of [
    { name: 'confirmApproval', arguments: { id: 'anything' } },
    { name: 'delete_donor', arguments: { donorId: 'anything' } },
    { name: 'propose_change', arguments: { action: 'reset' } },
    { name: 'get_donor_context', arguments: { view: 'overview', query: null, sql: 'SELECT * FROM donors' } },
    { name: 'draft_note', arguments: { donorId: 'anything', language: 'en', giveMiami: false }, approved: true },
  ]) assert.equal((await tool(toolRequest(input))).status, 400);
  assert.equal((await tool(request('x'.repeat(17_000), { path: 'realtime/tool', contentType: 'application/json' }))).status, 413);
});

test('tool readouts are bounded and exclude donor contact fields and raw rows', async () => {
  const data = snapshot();
  const late = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'late', query: null } }, data);
  assert.equal((late.output.donors as unknown[]).length, 8);
  assert.equal(late.output.hasMore, true);
  const person = data.donors[0];
  const detail = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'donor', query: person.id } }, data);
  const modelText = JSON.stringify(detail.output);
  assert.ok(!modelText.includes('email'));
  assert.ok(!modelText.includes('phone'));
  assert.ok(!modelText.includes('address'));
  assert.ok(!modelText.includes('sourceFile'));
  assert.ok(!modelText.includes('raw_json'));
  if (person.email) assert.ok(!modelText.includes(person.email));
  assert.equal(detail.result?.donorId, person.id);
});

test('ambiguous names return choices without selecting a donor or changing records', async () => {
  const person = (id: string, name: string): Donor => ({ id, name, email: '', phone: '', address: '', language: 'en', records: [], gifts: [] });
  const data: Snapshot = { donors: [person('maria1', 'Maria Cruz'), person('maria2', 'María Perez')], matches: [], flags: [], outreach: [], merges: [], sources: [], today: '2026-11-07', demo: true, aiAvailable: false, giftCount: 0, totalCents: 0 };
  const result = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'donor', query: 'Maria' } }, data);
  assert.equal(result.output.needsClarification, true);
  assert.equal(result.output.count, 2);
  assert.equal(result.result?.donorId, undefined);
  assert.equal(result.result?.approval, undefined);
  assert.deepEqual(result.result?.donorIds, ['maria1', 'maria2']);
});

test('voice merge proposal preserves every donor and gift and withholds approval tokens from the model', async () => {
  const before = snapshot();
  const match = before.matches.find(item => item.status === 'pending' && item.recordIds.length === 3);
  assert.ok(match);
  const response = await tool(toolRequest({ name: 'propose_change', arguments: { action: 'merge', donorId: null, candidateId: match.id, status: null, resultNote: '' } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.result.approval.id);
  assert.equal(result.output.approval_required, true);
  assert.equal(result.output.changesMade, false);
  const modelText = JSON.stringify(result.output);
  assert.ok(!modelText.includes(result.result.approval.id));
  assert.ok(!modelText.includes(match.id));
  assert.equal('approval' in result.output, false);
  assert.equal('action' in result.output, false);
  const after = snapshot();
  assert.equal(after.donors.length, before.donors.length);
  assert.equal(after.giftCount, before.giftCount);
  assert.equal(after.totalCents, before.totalCents);
  assert.equal(after.merges.length, before.merges.length);
  const row = getStore().prepare('SELECT consumed FROM approvals WHERE id=?').get(result.result.approval.id);
  assert.equal(row?.consumed, 0);
});

test('voice contact proposal records no outreach and drafts remain unsent factual templates', async () => {
  const data = snapshot();
  const person = data.donors[0];
  const proposal = await runRealtimeTool({ name: 'propose_change', arguments: { action: 'contact', donorId: person.id, candidateId: null, status: 'Called', resultNote: 'Please check in next week.' } }, data);
  assert.equal(proposal.output.changesMade, false);
  assert.deepEqual(snapshot().outreach, data.outreach);
  const note = await runRealtimeTool({ name: 'draft_note', arguments: { donorId: person.id, language: 'es', giveMiami: false } }, data);
  assert.equal(note.output.sent, false);
  assert.equal(note.output.drafting, 'template');
  assert.equal(note.result?.mode, 'demo');
  assert.match(String(note.output.note), /^Hola /);
  assert.equal(note.result?.approval, undefined);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
