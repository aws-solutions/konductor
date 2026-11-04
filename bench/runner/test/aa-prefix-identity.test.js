// SPDX-License-Identifier: Apache-2.0
'use strict';

// A/A pairing and the prompt prefix: an arm run with `--arm-prefix` (a forced-load arm) is a different condition from the
// same ref without it, so the verdict, the orchestrator pass rule and the A/A arm picker never pair the two. Arms without a
// prefix keep the identity they always had. Pure inputs, no run directories.

const test = require('node:test');
const assert = require('node:assert/strict');
const { aaGroups, prefixIdentity } = require('../../report/verdict.js');
const { aaArmFor } = require('../lib/profiles.js');

const SHA = 'a'.repeat(40);
const P1 = { sha256: '1'.repeat(64), bytes: 120 };
const P2 = { sha256: '2'.repeat(64), bytes: 120 };
const row = (armId, extra = {}) => ({ armId, task: 't', rep: 1, commitSha: SHA, contentHash: null, armConfig: null, armPrefix: null, ...extra });
const input = (armIds, rows) => ({ run: { config: { armIds } }, rows });

test('a forced arm and the unprefixed control of the same ref are not an A/A pair (the reproduced [["ctl","frc"]] case)', () => {
  const rows = [row('vanilla', { commitSha: null }), row('ctl'), row('frc', { armPrefix: P1 })];
  assert.deepEqual(aaGroups(input(['vanilla', 'ctl', 'frc'], rows), 'vanilla'), []);
});

test('arms without a prefix pair exactly as before, and two arms with the same prefix pair with each other', () => {
  const plain = [row('vanilla', { commitSha: null }), row('ctl'), row('ctl-b'), row('other', { commitSha: 'b'.repeat(40) })];
  assert.deepEqual(aaGroups(input(['vanilla', 'ctl', 'ctl-b', 'other'], plain), 'vanilla'), [['ctl', 'ctl-b']]);
  const cfg = [row('ctl'), row('ctl-b'), row('coord', { armConfig: { orchestration: { mode: 'coordinator' } } })];
  assert.deepEqual(aaGroups(input(['ctl', 'ctl-b', 'coord'], cfg), 'x'), [['ctl', 'ctl-b']]);
  const forced = [row('ctl'), row('frc', { armPrefix: P1 }), row('frc-b', { armPrefix: P1 }), row('del', { contentHash: 'c'.repeat(12), commitSha: null, armPrefix: P2 })];
  assert.deepEqual(aaGroups(input(['ctl', 'frc', 'frc-b', 'del'], forced), 'x'), [['frc', 'frc-b']]);
  assert.equal(prefixIdentity([row('ctl')]), '');
});

test('fail closed: an arm whose runs disagree on the prefix, or carry one without a hash, is never paired', () => {
  const mixed = [row('ctl'), row('ctl'), row('frc', { armPrefix: P1 }), row('frc', { armPrefix: null })];
  assert.equal(prefixIdentity(mixed.filter((r) => r.armId === 'frc')), null);
  assert.deepEqual(aaGroups(input(['ctl', 'frc'], [...mixed, row('ctl-b')]), 'x'), [['ctl', 'ctl-b']]);
  const unhashed = [row('frc', { armPrefix: { bytes: 10 } }), row('frc-b', { armPrefix: { bytes: 10 } })];
  assert.deepEqual(aaGroups(input(['frc', 'frc-b'], unhashed), 'x'), []);
});

test('the A/A arm picker sees a prefixed arm as a new condition, and keeps the old identity for arms without one', () => {
  const ctl = { id: 'ctl', commitSha: SHA, runtime: 'kiro-cli' };
  assert.equal(aaArmFor([ctl, { ...ctl, id: 'ctl-b' }]).spec, null, 'two plain arms of one ref are already a pair');
  const frc = { ...ctl, id: 'frc', prefixInfo: P1 };
  assert.ok(aaArmFor([ctl, frc]).spec, 'a plain and a prefixed arm of one ref are not a pair, so a repeat is added');
  assert.equal(aaArmFor([frc, { ...frc, id: 'frc-b' }]).spec, null);
});
