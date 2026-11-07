// SPDX-License-Identifier: Apache-2.0
'use strict';

// The diagram, design, guide and task additions to the quality pack. Pack content, gating on synthetic files, quote checking
// and the frozen fingerprint of the earlier criteria. No model call and no runner process.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../../judge/pack/index.js');

const pack = P.loadPack('quality');
const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quality-pack-66.json'), 'utf8'));
const fingerprint = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// Criteria whose text was extended on purpose; everything else must match its frozen fingerprint exactly.
const EXTENDED = new Set([]);

test('every criterion of the earlier pack keeps its text, weight, evidence rule and artifact types unless it is listed as extended', () => {
  assert.equal(Object.keys(frozen.criteria).length, 66);
  for (const [id, old] of Object.entries(frozen.criteria)) {
    const now = pack.criteria.find((c) => c.id === id);
    assert.ok(now, `${id} was removed`);
    const { appliesTo, ...rest } = now;
    assert.deepEqual(appliesTo, old.appliesTo, `${id}: artifact types changed`);
    if (!EXTENDED.has(id)) assert.equal(fingerprint(rest), old.fingerprint, `${id}: text, weight or evidence rule changed`);
  }
});

test('the counted-criteria lists, artifact types and earlier dimensions are unchanged', () => {
  for (const [key, sha] of Object.entries(frozen.data)) assert.equal(fingerprint(pack[key]), sha, key);
  assert.equal(fingerprint(pack.dimensions.slice(0, 13)), frozen.dimensions, 'the first 13 dimensions keep their ids, labels and order');
});

test('task declarations of the earlier pack are unchanged', () => {
  for (const [id, list] of Object.entries(frozen.taskArtifacts)) assert.deepEqual(pack.taskArtifacts[id], list, id);
});
