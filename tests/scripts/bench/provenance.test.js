// SPDX-License-Identifier: Apache-2.0
// Tests for the hashes and the judgment input digest (scripts/bench/lib/provenance.js). The digest pinned here is
// the contract: if it changes, every stored judgment turns stale, so a change must be deliberate.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const provenance = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');

const { makeFakeSha256 } = helpers;
const SHA_ABC =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('sha256: published vectors for strings and buffers; values hash as stable JSON', () => {
  assert.equal(provenance.sha256('abc'), SHA_ABC);
  assert.equal(provenance.sha256(Buffer.from('abc')), SHA_ABC);
  assert.equal(
    provenance.sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    provenance.sha256({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }),
    provenance.sha256({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }),
    'key order does not matter',
  );
  assert.notEqual(provenance.sha256({ a: 1 }), provenance.sha256({ a: 2 }));
  assert.notEqual(
    provenance.sha256([1, 2]),
    provenance.sha256([2, 1]),
    'array order does',
  );
  assert.equal(
    JSON.stringify(provenance.sortKeysDeep({ b: 1, a: 2 })),
    '{"a":2,"b":1}',
  );
});

test('fileSha256 hashes the bytes of the file and nothing else', () => {
  helpers.withTmp((dir) => {
    const [firstFile, secondFile] = ['one.md', 'two.md'].map((name) =>
      path.join(dir, name),
    );
    helpers.write(firstFile, 'abc');
    helpers.write(secondFile, 'abc');
    assert.equal(provenance.fileSha256(firstFile), SHA_ABC);
    assert.equal(
      provenance.fileSha256(firstFile),
      provenance.fileSha256(secondFile),
      'the path and name do not enter the hash',
    );
    helpers.write(secondFile, 'abc\n');
    assert.notEqual(
      provenance.fileSha256(secondFile),
      SHA_ABC,
      'one extra byte changes the hash',
    );
    assert.throws(
      () => provenance.fileSha256(path.join(dir, 'missing.md')),
      /ENOENT/,
    );
  });
});

test('a checklist hash depends on the order of its items', () => {
  assert.notEqual(
    provenance.checklistSha256(['a', 'b']),
    provenance.checklistSha256(['b', 'a']),
  );
  assert.equal(
    provenance.checklistSha256(['a', 'b']),
    provenance.checklistSha256(['a', 'b']),
  );
});

const judgment = {
  arm: 'with',
  answerSha256: makeFakeSha256('6'),
  checklistSha256: makeFakeSha256('8'),
  judgePromptSha256: makeFakeSha256('9'),
  judgeModel: 'judge-model',
  sanitizerVersion: 1,
  sanitizerRulesSha256: makeFakeSha256('e'),
  openCodeVersion: '4.5.6',
};
const OTHER_SHA = makeFakeSha256('f');
const PINNED_DIGEST =
  'dcf98d1bfd80fa3ff27a2cbc6a2046f12255c4c064ab5ae97a8add740d8f9971';

test('judgment inputs: the digest is pinned, stable, and changed by every digested field', () => {
  const changes = {
    arm: 'without',
    answerSha256: OTHER_SHA,
    checklistSha256: OTHER_SHA,
    judgePromptSha256: OTHER_SHA,
    judgeModel: 'other',
    sanitizerVersion: 2,
    sanitizerRulesSha256: OTHER_SHA,
  };
  assert.equal(provenance.judgmentInputs(judgment).kind, 'judgment');
  assert.equal(provenance.judgmentInputs(judgment).input_sha256, PINNED_DIGEST);
  assert.equal(
    provenance.judgmentInputs({ ...judgment }).input_sha256,
    PINNED_DIGEST,
    'the same inputs always give the same digest',
  );
  for (const [field, changedValue] of Object.entries(changes))
    assert.notEqual(
      provenance.judgmentInputs({ ...judgment, [field]: changedValue })
        .input_sha256,
      PINNED_DIGEST,
      field,
    );
});

test('a judgment digest holds only its own arm and that arm answer hash', () => {
  const record = provenance.judgmentInputs(judgment);
  assert.equal(record.arm, 'with');
  assert.equal(record.answer_sha256, judgment.answerSha256);
  assert.ok(!('order' in record));
  assert.ok(!('answer_with_sha256' in record));
  assert.ok(!('answer_without_sha256' in record));
  // The same answer hash judged as the other arm is a different judgment.
  assert.notEqual(
    provenance.judgmentInputs({ ...judgment, arm: 'without' }).input_sha256,
    record.input_sha256,
  );
});

test('the OpenCode version is recorded but is not part of the digest', () => {
  const newer = provenance.judgmentInputs({
    ...judgment,
    openCodeVersion: '0.0.1',
  });
  assert.equal(newer.opencode_version, '0.0.1');
  assert.equal(newer.input_sha256, PINNED_DIGEST);
  assert.equal(
    provenance.judgmentInputs({ ...judgment, openCodeVersion: undefined })
      .opencode_version,
    null,
  );
});

test('a missing required input is an error that names it', () => {
  const missing = [
    [
      () => provenance.judgmentInputs({ ...judgment, answerSha256: undefined }),
      /answer_sha256 is required/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, judgeModel: '' }),
      /judgment inputs: judge_model is required/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, arm: 'both' }),
      /arm must be one of with, without/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, arm: undefined }),
      /arm must be one of with, without/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, sanitizerVersion: 0 }),
      /sanitizer_version must be a whole number, 1 or more, got 0/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, sanitizerVersion: 1.5 }),
      /sanitizer_version must be a whole number, 1 or more, got 1\.5/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, sanitizerVersion: '1' }),
      /sanitizer_version must be a whole number, 1 or more, got "1"/,
    ],
    [
      () => provenance.judgmentInputs({ ...judgment, sanitizerVersion: null }),
      /sanitizer_version is required/,
    ],
  ];
  for (const [build, pattern] of missing) assert.throws(build, pattern);
});

test('records hold no path, time or host name', () => {
  const text = JSON.stringify(provenance.judgmentInputs(judgment));
  assert.doesNotMatch(text, /\/Users\/|\/home\/|\d{4}-\d{2}-\d{2}T/);
});
