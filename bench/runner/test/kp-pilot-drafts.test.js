// SPDX-License-Identifier: Apache-2.0
// The drafted pilot baselines of the skill keep-or-prune restart (bench/cap/baseline-drafts): five skills, each with
// rules, two batches of 8 tasks and a selection set, checked by the same verifier as the frozen baselines. Drafts are
// not frozen: no run reads them until a person signs them off and they move to bench/cap/baselines. No model, no spend.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { verifyBaselines } = require('../../cap/baselineverify.js');
const { BASELINES_DIR } = require('../../cap/frozen.js');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DRAFTS = path.join(REPO, 'bench', 'cap', 'baseline-drafts');
const PILOT = ['adversarial-design-review', 'design-quality-check', 'doc-accuracy-analyzer', 'threat-modeling', 'verification'];

test('the pilot drafts pass the baseline verifier with no problem', () => {
  const v = verifyBaselines({ dir: DRAFTS, skillsDir: path.join(REPO, 'skills') });
  assert.deepEqual(v.problems, []);
  assert.deepEqual([...v.skills.keys()].sort(), PILOT);
});

test('each pilot draft has two batches of 8 tasks, a selection set and recorded provenance', () => {
  const v = verifyBaselines({ dir: DRAFTS, skillsDir: path.join(REPO, 'skills') });
  for (const name of PILOT) {
    const b = v.skills.get(name);
    assert.equal(b.batches.length, 2, name);
    for (const batch of b.batches) assert.equal(batch.tasks.scenarios.length, 8, `${name} ${batch.batch}`);
    assert.ok(b.selection, `${name} has selection.json`);
    for (const kind of ['load', 'none']) assert.ok(b.selection.requests.filter((r) => r.expect === kind).length >= 5, `${name} ${kind}`);
    assert.ok(b.rules.source?.subject?.sha256, `${name} rules.source`);
    assert.equal(v.manifest.sources[name].subject_sha256, b.rules.source.subject.sha256, name);
  }
});

test('drafts stay out of the frozen folder until signed off', () => {
  assert.notEqual(DRAFTS, BASELINES_DIR);
  const frozen = verifyBaselines({ dir: BASELINES_DIR, skillsDir: path.join(REPO, 'skills') });
  for (const name of PILOT) assert.equal(frozen.skills.get(name)?.selection ?? null, null, `${name} has no frozen selection yet`);
});
