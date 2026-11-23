// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap/unitauthor.js: a briefs file may swap who writes and who reviews, so a rewrite is not written by the family that
// wrote the first tasks; one family never checks its own work and Claude takes no part. The FW-30 briefs use it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { familiesOf, planOf, DEFAULT_FAMILIES, loadBriefs } = require('../../cap/unitauthor.js');
const { UNIT_BASELINES_DIR } = require('../../cap/units.js');

test('familiesOf: default glm-5 writes; a swap is allowed; one family twice, an unknown model or Claude is refused', () => {
  assert.deepEqual(familiesOf({}, 'f'), DEFAULT_FAMILIES);
  assert.deepEqual(familiesOf({ families: { writer: 'deepseek-3.2', reviewer: 'glm-5' } }, 'f'), { writer: 'deepseek-3.2', reviewer: 'glm-5' });
  assert.throws(() => familiesOf({ families: { writer: 'glm-5', reviewer: 'glm-4.6' } }, 'f'), /one family \(glm\)/);
  assert.throws(() => familiesOf({ families: { writer: 'nope-1', reviewer: 'glm-5' } }, 'f'), /known family/);
  assert.throws(() => familiesOf({ families: { writer: 'claude-sonnet-5.5', reviewer: 'glm-5' } }, 'f'), /Claude/);
});

test('planOf follows the families: the writer writes and fixes, the reviewer reviews and rechecks', () => {
  const p = planOf(['b1'], { writer: 'deepseek-3.2', reviewer: 'glm-5' });
  assert.deepEqual(p.map((x) => `${x.step}:${x.model}`), ['write:deepseek-3.2', 'review:glm-5', 'fix:deepseek-3.2', 'recheck:glm-5']);
});

test('the FW-30 briefs: 16 briefs in two batches of 8, deepseek-3.2 writes and glm-5 reviews', () => {
  const f = path.join(UNIT_BASELINES_DIR, 'context-k-orchestrator-shared', 'briefs-fw30.json');
  const b = loadBriefs(f, 'context:k-orchestrator-shared');
  assert.deepEqual(b.families, { writer: 'deepseek-3.2', reviewer: 'glm-5' });
  assert.equal(b.briefs.length, 16);
  for (const x of b.briefs) assert.ok(x.id && x.section && x.situation && x.good, x.id);
});
