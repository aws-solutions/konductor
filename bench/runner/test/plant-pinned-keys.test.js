// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner trusts every key in pinned-keys.json. A script that pins a throwaway key into a checkout and dies before
// it restores the file leaves that checkout trusting a key anyone could hold (review 2026-11-23 F4). These tests fail
// on such a checkout, so the next suite run there says so.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { toyPublicKeyB64 } = require('../../physical/toy/toy-release.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const REL = 'bench/runner/lib/plant/pinned-keys.json';

test('pinned-keys.json is the committed file: no uncommitted key in this checkout', (t) => {
  const inGit = spawnSync('git', ['-C', ROOT, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inGit.status !== 0) return t.skip('not a git checkout');
  const r = spawnSync('git', ['-C', ROOT, 'diff', '--quiet', 'HEAD', '--', REL], { encoding: 'utf8' });
  const diff = r.status === 0 ? '' : spawnSync('git', ['-C', ROOT, 'diff', 'HEAD', '--', REL], { encoding: 'utf8' }).stdout;
  assert.equal(r.status, 0, `${REL} differs from HEAD; a script may have left a throwaway key pinned:\n${diff}`);
});

test('pinned keys are active, revoked or the one public toy key', () => {
  const keys = require(path.join(ROOT, REL));
  for (const k of keys) assert.ok(['active', 'revoked', 'toy'].includes(k.status), `${k.keyId}: status ${k.status}`);
  const toys = keys.filter((k) => k.status === 'toy');
  assert.deepEqual(toys.map((k) => k.publicKey), [toyPublicKeyB64()], 'exactly one toy key, the public one from toy-release.js');
});
