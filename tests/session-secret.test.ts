import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionSecret } from '../src/lib/http';

const directory = mkdtempSync(join(tmpdir(), 'giftguard-secret-'));

test('the session secret persists beside the database so a server restart does not sign everyone out', () => {
  const file = join(directory, 'one', 'giftguard.sqlite');
  const first = loadSessionSecret(file);
  const second = loadSessionSecret(file);
  assert.equal(first.length, 32);
  assert.ok(first.equals(second));
  const secretFile = join(directory, 'one', '.session-secret');
  assert.ok(existsSync(secretFile));
  assert.equal(statSync(secretFile).mode & 0o777, 0o600);
  assert.ok(!loadSessionSecret(join(directory, 'two', 'giftguard.sqlite')).equals(first), 'a different workspace gets its own secret');
});

test('an explicit environment secret wins and a short one is ignored', () => {
  const file = join(directory, 'three', 'giftguard.sqlite');
  assert.ok(loadSessionSecret(file, 'x'.repeat(40)).equals(Buffer.from('x'.repeat(40))));
  assert.equal(loadSessionSecret(file, 'too-short').length, 32);
  assert.ok(!loadSessionSecret(file, 'too-short').equals(Buffer.from('too-short')));
});

test.after(() => rmSync(directory, { recursive: true, force: true }));
