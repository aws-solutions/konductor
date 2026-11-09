// SPDX-License-Identifier: Apache-2.0
'use strict';

// A budget-skipped run has no stream. The reference and probe reports must label it budget-skipped, not no-stream,
// and print the sandbox errno sentence only when an excluded row has errno hits. Built from files in a scratch dir; no runner start.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');
const R = require('../../report/refs.js');
const P = require('../../report/probes.js');

const REFS_TASK = 'refs-dynamodb-design';
const PROBE_TASK = 'probe-u3-circuit-breaker';

function skippedRun(root, { arm, task, rep = 1, status = 'budget_skipped' }) {
  const dir = path.join(root, arm, 'k-architect', task, String(rep));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ armId: arm, taskId: task, replicate: rep, agent: 'k-architect', status }));
  return dir;
}

test('refs: a budget-skipped run is excluded as budget-skipped, not no-stream', () => {
  const root = mkScratch('budget-skip-refs-');
  const manifest = R.loadManifest();
  const skipped = R.scoreRun(skippedRun(root, { arm: 'refs-pr155', task: REFS_TASK }), { manifest });
  assert.equal(skipped.usable, false);
  assert.equal(skipped.excludedReason, 'budget-skipped');
  const missing = R.scoreRun(skippedRun(root, { arm: 'refs-pr155', task: REFS_TASK, rep: 2, status: 'success' }), { manifest });
  assert.equal(missing.excludedReason, 'no-stream');
});

test('refs report: the errno sentence appears only when an excluded row has errno hits', () => {
  const manifest = R.loadManifest();
  const mk = (over) => ({ arm: 'refs-pr155', task: REFS_TASK, rep: 1, role: 'reference', usable: false, excludedReason: 'budget-skipped', errnoHits: [], ...over });
  const render = (rows) => R.renderReport({ rows, table: R.armTable(rows, manifest), decision: R.decide(rows, R.THRESHOLDS), control: R.controlCheck(rows, R.THRESHOLDS), readable: R.readableCheck(rows), manifest });
  const SENTENCE = 'Sandbox errno 38 runs are listed here and counted in no rate';

  const plain = render([mk({})]);
  assert.match(plain, /refs-pr155 \/ refs-dynamodb-design #1: budget-skipped\.\n/);
  assert.ok(!plain.includes(SENTENCE));

  const withErrno = render([mk({}), mk({ rep: 2, excludedReason: 'sandboxErrno', errnoHits: [{ source: 'stderr', match: 'ENOSYS' }] })]);
  assert.ok(withErrno.includes(SENTENCE));
});

test('probes: a budget-skipped run is excluded as budget-skipped, not as a missing stream', () => {
  const root = mkScratch('budget-skip-probes-');
  const manifest = P.loadManifest();
  const row = P.scoreRun(skippedRun(root, { arm: 'k-canary', task: PROBE_TASK }), { manifest });
  assert.equal(row.usable, false);
  assert.equal(row.excludedReason, 'budget-skipped');
  assert.deepEqual(row.problems, []);
});
