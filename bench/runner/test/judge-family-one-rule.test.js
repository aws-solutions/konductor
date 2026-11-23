// SPDX-License-Identifier: Apache-2.0
// One judge family rule for the whole bench (SR-24): judge/family.js familyOf. The panel check, the judge check, the
// panel swap and the report labels all read it, so two ids of one family can never count as two. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MODEL_FAMILIES, familyOf } = require('../../judge/family.js');
const config = require('../../judge/config.js');
const { checkPanel, checkJudgeModel, families } = config;

const BENCH = path.join(__dirname, '..', '..');

test('every id in the model table reads as its family', () => {
  for (const [id, family] of Object.entries(MODEL_FAMILIES)) assert.equal(familyOf(id), family, id);
});

test('two ids of one family are never counted as two families', () => {
  const byFamily = new Map();
  for (const [id, family] of Object.entries(MODEL_FAMILIES)) byFamily.set(family, [...(byFamily.get(family) ?? []), id]);
  let pairs = 0;
  for (const ids of byFamily.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let k = i + 1; k < ids.length; k++) {
        pairs++;
        assert.throws(() => checkPanel([ids[i], ids[k]]), /one judge per family/, `${ids[i]} + ${ids[k]}`);
        assert.equal(families([ids[i], ids[k]]).length, 1, `${ids[i]} + ${ids[k]}`);
      }
    }
  }
  assert.ok(pairs > 5, 'the table holds several ids per family');
});

test('the review case: gpt-oss and gpt-5 are one family, so the panel has two families, not three', () => {
  assert.throws(() => checkPanel(['openai.gpt-oss-120b', 'gpt-5', 'glm-4.6'], { minFamilies: 3 }), /both gpt models/);
  assert.equal(familyOf('o3'), 'gpt');
  assert.equal(familyOf('us.meta.llama4-maverick'), 'llama');
});

test('a judge of unknown family never counts as a family', () => {
  assert.throws(() => checkPanel(['my-house-model-7']), /0 known model family/);
  assert.throws(() => checkPanel(['my-house-model-7', 'other-model-2', 'gpt-5'], { minFamilies: 3 }), /1 known model family/);
  assert.deepEqual(families(['my-house-model-7', 'gpt-5']), ['gpt']);
  assert.throws(() => checkJudgeModel('openai.gpt-oss-120b', 'gpt-5.5'), /same family/);
  assert.doesNotThrow(() => checkPanel(['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'], { minFamilies: 3 }));
});

test('no module writes its own family rule: config.js no longer exports modelFamily, and no source defines one', () => {
  assert.equal(config.modelFamily, undefined);
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'tasks', '.git'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && /\bmodelFamily\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(BENCH, p));
    }
  };
  walk(BENCH);
  assert.deepEqual(hits, []);
});
