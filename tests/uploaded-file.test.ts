import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { importRows } from '../src/lib/importer';
import { FILE_PREVIEW_LIMIT, getUploadedFile, listUploadedFiles, resetStore } from '../src/lib/store';
import { GET as file } from '../src/app/api/file/route';
import { POST as login } from '../src/app/api/login/route';
const directory = mkdtempSync(join(tmpdir(), 'giftguard-file-'));
process.env.GIFTGUARD_DB = join(directory, 'test.sqlite');
process.env.GIFTGUARD_DEMO = 'true';
delete process.env.GIFTGUARD_PASSWORD;

test('an upload can be shown back as a table of its own columns, newest gift first, without rows that were not imported', () => {
  resetStore();
  const rows = [
    { 'Donor Name': 'Alicia Lopez', 'Gift Amount': '25', 'Gift Date': '2026-10-01', Notes: 'first' },
    { 'Donor Name': 'Ben Ortiz', 'Gift Amount': '40', 'Gift Date': '2026-11-01', Notes: 'second', Extra: 'only here' },
    { 'Donor Name': 'Refund Row', 'Gift Amount': '40', 'Gift Date': '2026-11-02', Notes: 'x', Status: 'refunded' },
  ];
  const result = importRows(rows, 'checks.csv', 'check', 'hash-one');
  assert.equal(result.imported, 2);
  const shown = getUploadedFile('checks.csv');
  assert.ok(shown);
  assert.equal(shown.source, 'check'); assert.equal(shown.total, 2); assert.equal(shown.rows.length, 2);
  assert.deepEqual(shown.headers, ['Donor Name', 'Gift Amount', 'Gift Date', 'Notes', 'Extra']);
  assert.equal(shown.rows[0]['Donor Name'], 'Ben Ortiz'); assert.equal(shown.rows[0].Extra, 'only here');
  assert.equal(shown.rows[1]['Donor Name'], 'Alicia Lopez'); assert.equal(shown.rows[1].Extra, '');
  assert.ok(!shown.rows.some(row => row['Donor Name'] === 'Refund Row'));
  assert.equal(getUploadedFile('missing.csv'), null);
  const files = listUploadedFiles();
  assert.equal(files.length, 1); assert.equal(files[0].file, 'checks.csv'); assert.equal(files[0].rows, 2);
});

test('spreadsheet dates show as calendar days and large files are previewed up to the limit', () => {
  resetStore();
  const many = Array.from({ length: FILE_PREVIEW_LIMIT + 20 }, (_, index) => ({ name: `Donor ${index}`, amount: 10 + index, date: new Date(Date.UTC(2026, 0, 1 + (index % 300))) }));
  assert.equal(importRows(many, 'big.csv', 'online', 'hash-big').imported, many.length);
  const shown = getUploadedFile('big.csv');
  assert.ok(shown);
  assert.equal(shown.total, many.length); assert.equal(shown.rows.length, FILE_PREVIEW_LIMIT);
  assert.match(shown.rows[0].date, /^2026-\d{2}-\d{2}$/);
  assert.equal(shown.rows[0].amount, String(10 + many.findIndex(row => row.date.toISOString().slice(0, 10) === shown.rows[0].date)));
});

test('the file route needs a sign-in, lists uploads, and returns one upload or a clear 404', async () => {
  resetStore();
  importRows([{ name: 'Alicia Lopez', amount: '25', date: '2026-10-01' }], 'checks.csv', 'check', 'hash-two');
  const request = (path: string, cookie = '') => new NextRequest(`http://localhost:3000/api/${path}`, { headers: cookie ? { cookie } : {} });
  assert.equal((await file(request('file'))).status, 401);
  const signed = await login(new NextRequest('http://localhost:3000/api/login', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'giftguard-demo' }) }));
  const cookie = signed.headers.get('set-cookie')!.split(';')[0];
  const list = await (await file(request('file', cookie))).json();
  assert.equal(list.files[0].file, 'checks.csv');
  const one = await file(request('file?name=checks.csv', cookie));
  assert.equal(one.status, 200); assert.equal((await one.json()).rows[0].name, 'Alicia Lopez');
  assert.equal((await file(request('file?name=nope.csv', cookie))).status, 404);
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
