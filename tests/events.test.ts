import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { addSignup, createEvent, deleteEvent, listEvents, matchSignup, parseEventRequest, parseSpokenDate, publicEvent, validateSignupInput } from '../src/lib/events';
import { executeCommandIntent, interpretOfflineCommand } from '../src/lib/agents';
import { toolActivity } from '../src/lib/agent-activity';
import { realtimeSession, runRealtimeTool } from '../src/lib/realtime';
import { snapshot } from '../src/lib/service';
import { POST as signup } from '../src/app/api/signup/route';
import { GET as events, POST as createRoute } from '../src/app/api/events/route';
import { POST as login } from '../src/app/api/login/route';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-events-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.OPENAI_API_KEY;
delete process.env.GIFTGUARD_PASSWORD;
const TODAY = '2026-11-07';

test('spoken dates resolve to the next occurrence and event sentences become a name, host and date', () => {
  assert.equal(parseSpokenDate('on November 21', TODAY), '2026-11-21');
  assert.equal(parseSpokenDate('Nov 21st', TODAY), '2026-11-21');
  assert.equal(parseSpokenDate('on the 3rd of March', TODAY), '2027-03-03', 'a date already passed this year rolls to next year');
  assert.equal(parseSpokenDate('11/21', TODAY), '2026-11-21');
  assert.equal(parseSpokenDate('2027-02-14', TODAY), '2027-02-14');
  assert.equal(parseSpokenDate('February 30', TODAY), null);
  assert.equal(parseSpokenDate('sometime soon', TODAY), null);
  const parsed = parseEventRequest('I have a new gala coming up for the Miami Foundation on November 21 can you make me a sign up list for that', TODAY);
  assert.deepEqual(parsed, { name: 'Miami Foundation Gala', host: 'Miami Foundation', date: '2026-11-21' });
  assert.equal(parseEventRequest('set up a sign-up sheet for our volunteer day on 12/5', TODAY).name, 'Volunteer Day on December 5');
  assert.equal(parseEventRequest('make a guest list for the spring dinner', TODAY).date, null);
});

test('events are created with a share code, guests are matched to donors for staff only, and empty lists can be removed', () => {
  const data = snapshot();
  const before = listEvents().length;
  const event = createEvent({ name: 'Miami Foundation Gala', host: 'Miami Foundation', date: '2026-11-21' }, TODAY, 'assistant');
  assert.match(event.code, /^[a-z0-9]{8}$/); assert.equal(event.createdBy, 'assistant');
  assert.equal(listEvents().length, before + 1);
  assert.deepEqual(publicEvent(event.code), { code: event.code, name: 'Miami Foundation Gala', host: 'Miami Foundation', date: '2026-11-21' });
  assert.equal(publicEvent('nope'), null);
  assert.throws(() => createEvent({ name: 'X', date: '2026-11-21' }, TODAY, 'staff'), /name/);
  assert.throws(() => createEvent({ name: 'Gala', date: 'next friday' }, TODAY, 'staff'), /date like/);
  assert.throws(() => createEvent({ name: 'Gala', date: '2031-01-01' }, TODAY, 'staff'), /three years/);
  const rosa = data.donors.find(donor => donor.name === 'Rosa Delgado')!;
  assert.equal(matchSignup({ name: 'R Delgado', email: rosa.email, phone: '', zip: '' }, data.donors)?.reason, 'Same email');
  assert.equal(matchSignup({ name: 'Somebody Else', email: '', phone: rosa.phone, zip: '' }, data.donors)?.reason, 'Same phone');
  assert.equal(matchSignup({ name: 'Rosa Delgado', email: '', phone: '', zip: '' }, data.donors)?.confidence, 'Medium');
  assert.equal(matchSignup({ name: 'Nobody Known', email: 'nobody@example.net', phone: '7865550000', zip: '00000' }, data.donors), null);
  const guest = addSignup(event.id, validateSignupInput({ name: 'Rosa Delgado', email: rosa.email, consent: true, pledge: '$250' }), data.donors);
  assert.equal(guest.matchDonorId, rosa.id); assert.equal(guest.pledgeCents, 25000);
  assert.throws(() => validateSignupInput({ name: 'A', email: 'x@y.z', consent: true }), /full name/);
  assert.throws(() => validateSignupInput({ name: 'Ana Ruiz', consent: true }), /email or a phone/);
  assert.throws(() => validateSignupInput({ name: 'Ana Ruiz', email: 'ana@example.org', consent: false }), /tick the box/);
  assert.throws(() => validateSignupInput({ name: 'Ana Ruiz', email: 'ana@example.org', consent: true, pledge: '-5' }), /pledge/);
  assert.throws(() => deleteEvent(event.id), /already has sign-ups/);
  const empty = createEvent({ name: 'Empty Dinner', date: '2026-12-01' }, TODAY, 'staff');
  assert.equal(deleteEvent(empty.id), true); assert.equal(deleteEvent(empty.id), false);
});

test('the demo workspace ships one past gala with guests, three of them matched to donors', () => {
  const data = snapshot();
  const gala = data.events.find(event => event.name === 'Fall Harvest Gala');
  assert.ok(gala); assert.equal(gala.signups.length, 5);
  assert.equal(gala.signups.filter(signup => signup.matchDonorId).length, 3);
  assert.equal(gala.signups.filter(signup => !signup.matchDonorId).length, 2);
});

test('the typed assistant creates a list from one sentence, asks for a missing date, and the voice tool does the same', async () => {
  const data = snapshot();
  const intent = interpretOfflineCommand('I have a new gala coming up for the Miami Foundation on November 21 can you make me a sign up list for that', data.today);
  assert.equal(intent.intent, 'event'); assert.equal(intent.eventName, 'Miami Foundation Gala'); assert.equal(intent.eventDate, '2026-11-21');
  const result = await executeCommandIntent(intent, data, 'demo');
  assert.equal(result.view, 'events'); assert.ok(result.eventId); assert.match(result.message, /Miami Foundation Gala on November 21, 2026/); assert.match(result.message, /what a guest will see/);
  assert.ok(listEvents().some(event => event.id === result.eventId && event.createdBy === 'staff'));
  const noDate = await executeCommandIntent(interpretOfflineCommand('make a guest list for the spring dinner', data.today), data, 'demo');
  assert.match(noDate.message, /What date/); assert.equal(noDate.eventId, undefined);
  assert.notEqual(interpretOfflineCommand('draft an email to our gala guests', data.today).intent, 'event');
  const session = realtimeSession(data.today);
  assert.ok(session.tools.some(tool => tool.name === 'create_event')); assert.match(session.instructions, /create_event/);
  const voice = await runRealtimeTool({ name: 'create_event', arguments: { name: 'Winter Benefit', host: null, date: '2026-12-12' } }, data);
  assert.equal(voice.result?.view, 'events'); assert.ok(voice.result?.eventId); assert.equal(voice.output.created, true); assert.match(String(voice.output.signupPath), /^\/signup\/[a-z0-9]{8}$/);
  assert.ok(!JSON.stringify(voice.output).includes('@example.org'));
  await assert.rejects(runRealtimeTool({ name: 'create_event', arguments: { name: 'Bad', host: null, date: 'tomorrow' } }, data));
  const page = await runRealtimeTool({ name: 'open_page', arguments: { page: 'events' } }, snapshot());
  assert.equal(page.result?.view, 'events');
  const list = await runRealtimeTool({ name: 'get_donor_context', arguments: { view: 'events', query: 'gala' } }, snapshot());
  assert.ok((list.output.events as { name: string }[]).some(event => event.name === 'Fall Harvest Gala'));
  assert.deepEqual(toolActivity('one', 'create_event', { name: 'x' }, 'working')?.targets, ['nav-events']);
  assert.deepEqual(toolActivity('one', 'create_event', { name: 'x' }, 'complete', { message: '', view: 'events', mode: 'ai' })?.targets, ['event-preview', 'event-detail']);
  assert.deepEqual(toolActivity('two', 'open_page', { page: 'events' }, 'complete', { message: '', view: 'events', mode: 'ai' })?.targets, ['event-list']);
});

test('the public sign-up route needs no sign-in but is same-origin, validated, and never returns donor data; staff routes need a sign-in', async () => {
  const code = listEvents()[0].code;
  const post = (data: unknown, origin = 'http://localhost:3000') => new NextRequest('http://localhost:3000/api/signup', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await signup(post({ code, name: 'Guest One', email: 'guest@example.net', consent: true }, 'http://evil.example'))).status, 403);
  assert.equal((await signup(post({ code: 'nope', name: 'Guest One', email: 'guest@example.net', consent: true }))).status, 404);
  assert.equal((await signup(post({ code, name: 'Guest One', consent: true }))).status, 400);
  const rosa = snapshot().donors.find(donor => donor.name === 'Rosa Delgado')!;
  const ok = await signup(post({ code, name: 'Rosa Delgado', email: rosa.email, consent: true, language: 'es' }));
  assert.equal(ok.status, 200);
  const result = await ok.json();
  assert.deepEqual(Object.keys(result).sort(), ['event', 'name', 'ok']);
  assert.ok(!JSON.stringify(result).includes('match') && !JSON.stringify(result).includes(rosa.id));
  assert.equal((await events(new NextRequest('http://localhost:3000/api/events'))).status, 401);
  const signed = await login(new NextRequest('http://localhost:3000/api/login', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'giftguard-demo' }) }));
  const cookie = signed.headers.get('set-cookie')!.split(';')[0];
  const created = await createRoute(new NextRequest('http://localhost:3000/api/events', { method: 'POST', headers: { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Staff Dinner', host: '', date: '2026-12-02' }) }));
  assert.equal(created.status, 200);
  const qr = await events(new NextRequest(`http://localhost:3000/api/events?qr=${(await created.json()).event.code}`, { headers: { cookie } }));
  assert.equal(qr.status, 200); assert.equal(qr.headers.get('content-type'), 'image/png');
  const listed = await (await events(new NextRequest('http://localhost:3000/api/events', { headers: { cookie } }))).json();
  assert.ok(listed.events.some((event: { name: string }) => event.name === 'Staff Dinner'));
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
