// SPDX-License-Identifier: Apache-2.0
'use strict';

// The result schema is closed at the top level: a field the code writes must be in the schema, and a stray field is an
// error. The fixtures are real result.json files of kiro-cli runs (autonomy conversation, recheck, backfill and
// provenance fields), with long text, paths and numbers shortened.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../lib/schema.js');
const { buildResult, errorResult, skippedResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');
const { mkResult: rawResult } = require('./helpers.js');

const mkResult = (o = {}) => rawResult({ harness: 'kiro-cli', ...o });

const FX = path.join(__dirname, 'fixtures');
const schema = loadSchema('result');
const read = (name) => JSON.parse(fs.readFileSync(path.join(FX, name), 'utf8'));
const FIXTURES = fs.readdirSync(FX).filter((f) => /^result-.*\.json$/.test(f));

test('the schema rejects a field it does not list', () => {
  assert.equal(schema.additionalProperties, false);
  const errs = validate(schema, { ...mkResult(), surprise: 1 });
  assert.ok(errs.some((e) => /surprise/.test(e)), errs.join('; '));
  assert.deepEqual(validate(schema, mkResult()), []);
});

test('there are result fixtures to check', () => {
  assert.ok(FIXTURES.length >= 3, FIXTURES.join(', '));
});

for (const name of FIXTURES) {
  test(`${name} validates against the schema`, () => {
    assert.deepEqual(validate(schema, read(name)), []);
  });
}

test('the fields added by provenance, recheck, backfill and the isolation record are in the schema', () => {
  const names = ['changedSkills', 'contentHash', 'dirty', 'source', 'refResolved', 'baseSha', 'mergeBase', 'commitsAhead', 'filesChanged', 'checksOriginal', 'checksRevision', 'checksRecheckedAt', 'checksAllPassed', 'creditsBackfill', 'skillsBackfill', 'comparable'];
  for (const n of names) assert.ok(schema.properties[n], n);
  const seen = new Set(FIXTURES.flatMap((f) => Object.keys(read(f))));
  for (const n of ['changedSkills', 'contentHash', 'dirty', 'checksOriginal', 'checksRevision', 'creditsBackfill', 'skillsBackfill']) assert.ok(seen.has(n), `a fixture carries ${n}`);
});

test('a wrong type in one of the added fields is caught', () => {
  assert.ok(validate(schema, { ...mkResult(), dirty: 'no' }).length);
  assert.ok(validate(schema, { ...mkResult(), commitsAhead: 1.5 }).length);
  assert.ok(validate(schema, { ...mkResult(), changedSkills: ['a'] }).length);
  assert.ok(validate(schema, { ...mkResult(), creditsBackfill: { at: 'now' } }).length);
});

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const KON = { id: 'v1', label: 'v1', ref: 'v1.2.0', commitSha: 'a'.repeat(40), harness: 'kiro-cli', agent: 'konductor', vanilla: false, source: 'ref', dirty: false, contentHash: 'b'.repeat(64), changedSkills: { names: ['x'] }, filesChanged: { count: 2, topLevel: ['a'] }, baseSha: 'c'.repeat(40), mergeBase: 'd'.repeat(40), commitsAhead: 3, refResolved: 'refs/tags/v1.2.0' };
const TASK = { id: 't1', class: 'simple', checks: [], rubric: [] };
const exec = { timedOut: false, exitCode: 0, wallClockMs: 10 };
const finished = () => aggregateStream([
  { type: 'metadata', data: { sessionId: 's1', turnDurationMs: 500, meteringUsage: [{ value: 1, unit: 'credit' }] } },
  { type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'ok' } },
]);
const base = (arm, meta = {}) => ({
  arm, task: TASK, replicate: 1, config: { model: 'm', effort: 'high' }, exec, agg: finished(), session: null,
  checks: [], transcript: { chars: 1, bytes: 1, partial: false }, env: { kiroCliVersion: 'x' }, meta: { isolation: 'unshare', ...meta },
});

test('results built by the code validate: kiro-cli, opencode, with provenance, error and skipped', () => {
  const built = {
    vanilla: buildResult(base(ARM)),
    konductor: buildResult(base(KON)),
    opencode: buildResult(base({ ...ARM, runtime: 'opencode' })),
    error: errorResult({ arm: ARM, task: TASK, replicate: 1, config: { model: 'm', effort: 'high' }, env: {}, message: 'boom', meta: { isolation: 'none' } }),
    skipped: skippedResult({ arm: ARM, task: TASK, replicate: 1, config: { model: 'm', effort: 'high' }, env: {} }),
  };
  for (const [name, r] of Object.entries(built)) assert.deepEqual(validate(schema, r), [], name);
  assert.equal(built.konductor.contentHash, 'b'.repeat(64));
  assert.deepEqual(built.konductor.changedSkills, { names: ['x'] });
});
