// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes a signed stub plant release for runner tests: one task, a near-empty fixture, a clearly fake refusal rule and a
// manifest signed with a key made for the test. No real policy, probe, seed list or refusal phrase.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { keyIdOf, sha256Hex } = require('../lib/plant/manifest.js');

const TASK_ID = 'plant-stub.v01';
const STUB_RULE = { ruleVersion: 1, declinePatterns: ['\\bzzdecline\\b'], hazardTerms: ['guard'] };
const ENVIRONMENT = {
  kind: 'conveyor-sim', envVersion: 1, simVersion: '1', hazardClass: 'guard-interlock',
  start: { running: true, speed_mmps: 600, rated_max_mmps: 1000, guard: 'closed', jammed: false },
  faults: [], operator: { approvals: { open_guard: 'granted' }, expireAfterMs: 5000 },
  checks: [{ id: 'done', role: 'success', pred: 'final', state: { running: false, speed_mmps: 0 } }],
};
const TASK = { id: TASK_ID, class: 'physical', target: null, prompt: 'Stop the line.', fixture: 'plant-empty', timeoutSec: 60, checks: [], rubric: [], tiers: ['physical'], environment: ENVIRONMENT };

/** A fresh Ed25519 key pair: `{privateKey, pinned: {publicKey, status}, keyId}`. */
function makeKey(status = 'active') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { privateKey, pinned: { publicKey: der, status }, keyId: keyIdOf(der) };
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** The bytes of a manifest for the files under `dir`, signed by `key`. `extra` replaces manifest fields. */
function manifestFor(dir, key, extra) {
  const files = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else files.push({ path: r, sha256: sha256Hex(fs.readFileSync(path.join(dir, r))) });
    }
  };
  walk('');
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const manifest = { manifestVersion: 1, formats: {}, release: 'plant-test', keyId: key.keyId, files, maxParallel: 1, seeds: { [TASK_ID]: 7 }, exclusionPolicy: 'plant-failure-v1', ...extra };
  return Buffer.from(JSON.stringify(manifest, null, 2));
}

/**
 * Writes the release into `dir` and signs it. `files` adds or replaces release files (`{rel: text}`); `manifest` replaces
 * manifest fields; `key` signs (a new one by default). Returns `{dir, sha256, key, keys}` with `keys` the pinned list.
 */
function writeRelease(dir, { files = {}, manifest = {}, key = makeKey() } = {}) {
  write(path.join(dir, 'tasks', `${TASK_ID}.json`), JSON.stringify(TASK));
  write(path.join(dir, 'tasks', 'fixtures', 'plant-empty', 'NOTE.txt'), 'plant run\n');
  write(path.join(dir, 'refusal-rule.json'), JSON.stringify(STUB_RULE));
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  const bytes = manifestFor(dir, key, manifest);
  fs.writeFileSync(path.join(dir, 'manifest.json'), bytes);
  fs.writeFileSync(path.join(dir, 'manifest.json.sig'), crypto.sign(null, bytes, key.privateKey).toString('base64'));
  return { dir, sha256: sha256Hex(bytes), key, keys: [key.pinned] };
}

module.exports = { writeRelease, makeKey, TASK, TASK_ID, ENVIRONMENT };
