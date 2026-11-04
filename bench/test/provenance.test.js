// SPDX-License-Identifier: Apache-2.0
/**
 * Provenance unit tests: stable JSON hashing and the pair, judgment and result input digests.
 * Run: node --test bench/test/provenance.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const prov = require('../lib/provenance');

const HEX = /^[0-9a-f]{64}$/;

test('sha256 of an object does not depend on key order at any depth', () => {
  assert.equal(
    prov.sha256({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } }),
    prov.sha256({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }),
  );
  assert.notEqual(prov.sha256({ a: 1 }), prov.sha256({ a: 2 }));
});

test('sha256: array order matters and the digest is hex', () => {
  assert.notEqual(prov.sha256([1, 2]), prov.sha256([2, 1]));
  assert.match(prov.sha256({ a: [1] }), HEX);
});

test('sha256: strings and buffers hash their bytes, with a known answer', () => {
  assert.match(prov.sha256('abc'), HEX);
  assert.equal(prov.sha256('abc'), prov.sha256(Buffer.from('abc')));
  assert.equal(prov.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(prov.sha256('{"a":1}'), prov.sha256({ a: 1 }), 'an object hashes as its sorted JSON text');
});

test('stable sorts keys and leaves values and array order alone', () => {
  assert.equal(JSON.stringify(prov.stable({ b: 1, a: { d: 1, c: 2 } })), '{"a":{"c":2,"d":1},"b":1}');
  assert.deepEqual(prov.stable([3, 1, 2]), [3, 1, 2]);
  assert.equal(prov.stable(null), null);
  assert.equal(prov.stable('x'), 'x');
});

test('the module exports the hash helpers and the three input builders', () => {
  assert.deepEqual(Object.keys(prov).sort(), [
    'ARMS',
    'PROVENANCE_VERSION',
    'assertFingerprint',
    'isSha256',
    'judgmentInputs',
    'pairInputs',
    'resultInputs',
    'sha256',
    'stable',
    'subjectInputs',
  ]);
  assert.equal(prov.PROVENANCE_VERSION, 1);
  assert.deepEqual([...prov.ARMS], ['with', 'without']);
});

const FP = 'replay@1';
const SUBJECT = { taskId: 'task-1', arm: 'with', request: 'Add a flag.', runnerFingerprint: FP };
const PAIR = {
  ...SUBJECT,
  answer: 'Done.',
  start: { 'a.md': 'one' },
  final: { 'a.md': 'two' },
  loaded: true,
};

test('subjectInputs: digests the task, request, arm and runner fingerprint', () => {
  const base = prov.subjectInputs(SUBJECT);
  assert.match(base.subject_input_sha256, HEX);
  assert.equal(base.provenance_version, prov.PROVENANCE_VERSION);
  assert.equal(base.runner_fingerprint, FP);
  assert.equal(prov.subjectInputs({ ...SUBJECT }).subject_input_sha256, base.subject_input_sha256);
  for (const change of [
    { taskId: 'task-2' },
    { arm: 'without' },
    { request: 'Add a flag!' },
    { runnerFingerprint: 'replay@2' },
  ]) {
    assert.notEqual(
      prov.subjectInputs({ ...SUBJECT, ...change }).subject_input_sha256,
      base.subject_input_sha256,
      JSON.stringify(change),
    );
  }
});

test('subjectInputs: refuses an unknown arm and a missing or malformed fingerprint', () => {
  assert.throws(() => prov.subjectInputs({ ...SUBJECT, arm: 'with2' }), /arm must be one of/);
  for (const bad of [undefined, null, '', '   ', 7, 'a\nb', 'x'.repeat(201)]) {
    assert.throws(
      () => prov.subjectInputs({ ...SUBJECT, runnerFingerprint: bad }),
      /runner_fingerprint/,
      String(bad),
    );
  }
  assert.throws(() => prov.subjectInputs({ ...SUBJECT, request: undefined }), /request/);
});

test('pairInputs: covers the stored outputs and the loaded flag', () => {
  const base = prov.pairInputs(PAIR);
  assert.match(base.pair_input_sha256, HEX);
  assert.equal(base.subject_input_sha256, prov.subjectInputs(SUBJECT).subject_input_sha256);
  for (const change of [
    { answer: 'Done!' },
    { start: { 'a.md': 'zero' } },
    { final: { 'a.md': 'three' } },
    { loaded: false },
    { runnerFingerprint: 'replay@2' },
  ]) {
    assert.notEqual(
      prov.pairInputs({ ...PAIR, ...change }).pair_input_sha256,
      base.pair_input_sha256,
      JSON.stringify(change),
    );
  }
  assert.throws(() => prov.pairInputs({ ...PAIR, loaded: 'yes' }), /loaded must be a boolean/);
  assert.throws(() => prov.pairInputs({ ...PAIR, final: { 'a.md': 3 } }), /must be a string/);
  assert.throws(() => prov.pairInputs({ ...PAIR, start: [] }), /plain object/);
});

const TEMPLATE = { version: 2, sha256: 'a'.repeat(64) };
const SANITIZER = { version: 2, hash: 'b'.repeat(64) };
const JUDGE = {
  request: 'Add a flag.',
  rubric: ['Names the flag.'],
  prompt: 'rendered prompt',
  template: TEMPLATE,
  scale: 'overall',
  sanitizer: SANITIZER,
  order: 'with-first',
  seat: 'seat-a',
};

test('judgmentInputs: any ingredient changes the digest', () => {
  const base = prov.judgmentInputs(JUDGE);
  assert.match(base.judge_input_sha256, HEX);
  assert.equal(prov.judgmentInputs({ ...JUDGE }).judge_input_sha256, base.judge_input_sha256);
  for (const change of [
    { request: 'Add a flag!' },
    { rubric: ['Names the flag.', 'More.'] },
    { prompt: 'rendered prompt 2' },
    { template: { ...TEMPLATE, sha256: 'c'.repeat(64) } },
    { template: { ...TEMPLATE, version: 3 } },
    { scale: 'items' },
    { sanitizer: { ...SANITIZER, version: 3 } },
    { sanitizer: { ...SANITIZER, hash: 'd'.repeat(64) } },
    { order: 'without-first' },
    { seat: 'seat-b' },
  ]) {
    assert.notEqual(
      prov.judgmentInputs({ ...JUDGE, ...change }).judge_input_sha256,
      base.judge_input_sha256,
      JSON.stringify(change),
    );
  }
});

test('judgmentInputs: has no field for the per-call marker id', () => {
  const inputs = prov.judgmentInputs(JUDGE);
  assert.ok(!Object.keys(inputs).some((k) => /nonce|marker/i.test(k)));
});

test('judgmentInputs: refuses a malformed template, sanitizer or rubric', () => {
  assert.throws(() => prov.judgmentInputs({ ...JUDGE, template: { version: 2 } }), /template/);
  assert.throws(() => prov.judgmentInputs({ ...JUDGE, sanitizer: { version: 1 } }), /sanitizer/);
  assert.throws(() => prov.judgmentInputs({ ...JUDGE, rubric: 'x' }), /rubric/);
});

const PAIR_RECORDS = ['with', 'without'].map((arm) => ({
  task_id: 'task-1',
  arm,
  loaded: arm === 'with',
  inputs: prov.pairInputs({ ...PAIR, arm, loaded: arm === 'with' }),
}));
const JUDGMENT_RECORD = {
  status: 'ok',
  raw_text: '{"winner":"A"}',
  inputs: prov.judgmentInputs(JUDGE),
};
const RESULT = {
  skill: 'toy-skill',
  ruleSha256: 'e'.repeat(64),
  tasks: [{ id: 'task-1', target_section: 'S1' }],
  pairs: PAIR_RECORDS,
  judgments: [JUDGMENT_RECORD],
  judges: [{ seat: 'seat-a', model: '<provider>/<model-1>' }],
};

test('resultInputs: any ingredient changes the digest, and order of the lists does not', () => {
  const base = prov.resultInputs(RESULT);
  assert.match(base.result_input_sha256, HEX);
  assert.equal(
    prov.resultInputs({ ...RESULT, pairs: [...PAIR_RECORDS].reverse() }).result_input_sha256,
    base.result_input_sha256,
  );
  const other = (j) => ({ ...JUDGMENT_RECORD, ...j });
  for (const change of [
    { ruleSha256: 'f'.repeat(64) },
    { pruneBlockedReason: 'review first' },
    { tasks: [{ id: 'task-1', target_section: 'S2' }] },
    { judges: [{ seat: 'seat-a', model: '<provider>/<model-2>' }] },
    { pairs: [PAIR_RECORDS[0]] },
    { pairs: [{ ...PAIR_RECORDS[0], loaded: false }, PAIR_RECORDS[1]] },
    { judgments: [other({ status: 'unparsable' })] },
    { judgments: [other({ raw_text: '{"winner":"B"}' })] },
    { judgments: [] },
  ]) {
    assert.notEqual(
      prov.resultInputs({ ...RESULT, ...change }).result_input_sha256,
      base.result_input_sha256,
      JSON.stringify(change),
    );
  }
});

test('resultInputs: a usage or cost change in a judgment does not change the digest', () => {
  const base = prov.resultInputs(RESULT);
  const noisy = { ...JUDGMENT_RECORD, usage: { input_tokens: 9 }, cost: { usd: 1 }, nonce: 'zz' };
  assert.equal(
    prov.resultInputs({ ...RESULT, judgments: [noisy] }).result_input_sha256,
    base.result_input_sha256,
  );
  assert.throws(() => prov.resultInputs({ ...RESULT, ruleSha256: 'nope' }), /ruleSha256/);
});
