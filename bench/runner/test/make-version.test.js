// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/make-version.js: a versioned task file points at its own hidden dir and drops the old version's
// dry-run and recheck bookkeeping, so a new key is scored and rechecked before it is locked.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { makeVersion } = require('../../scenarios/make-version.js');

const base = { id: 't1-a', version: 4, prompt: 'Fix it.', fixture: 't1-a', hidden: 't1-a', checks: [], handEdited: { family: 'gpt', editor: 'x', log: 'HAND-EDITS.md', version: 4 }, review: { recheck: { family: 'glm', version: 4, items: [] } }, pilot: { reference: 100, stub: 0, decision: 'keep', date: '2026-11-20', dryRun: { reference: 100, stub: 0, lazy: 20, alt: 90, date: '2026-11-20' } } };

test('a versioned task file carries the new id, version, hidden dir and editor, and no bookkeeping of the old key', () => {
  const dir = tmp();
  write(path.join(dir, 't1', 't1-a.json'), JSON.stringify(base));
  write(path.join(dir, 't1', 'hidden', 't1-a-v5', 'key.json'), '{}');
  const out = makeVersion(dir, 't1', 't1-a', 5, 'mate (why)', { now: () => '2026-11-24' });
  assert.equal(out, path.join(dir, 't1', 't1-a-v5.json'));
  const t = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(t.id, 't1-a-v5');
  assert.equal(t.version, 5);
  assert.equal(t.fixture, 't1-a');
  assert.equal(t.hidden, 't1-a-v5');
  assert.equal(t.prompt, 'Fix it.');
  assert.deepEqual(t.handEdited, { family: 'claude', editor: 'mate (why)', log: 'HAND-EDITS.md', version: 5 });
  assert.deepEqual(t.review.recheck, { family: 'glm', items: [] }, 'the old recheck covers no later version');
  assert.deepEqual(t.pilot, { reference: 100, stub: 0, decision: 'keep', date: '2026-11-24' }, 'no copied dry run');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 't1', 't1-a.json'), 'utf8')), base, 'the base file is untouched');
  assert.throws(() => makeVersion(dir, 't1', 't1-a', 5, 'again'), /exists/);
  assert.throws(() => makeVersion(dir, 't1', 't1-a', 4, 'x'), /not above/);
  assert.throws(() => makeVersion(dir, 't1', 't1-a', 6, 'x'), /hidden\/t1-a-v6 does not exist/);
});
