// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/scenarios/konductor/manifest.json (B-009): the run levels of every scenario, generated from levels.js. It must
// match what levels.js picks from the current pack, so the levels cannot drift from the rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildManifest, packTasks, render, MANIFEST_FILE } = require('../../scenarios/konductor/manifest.js');
const { selectLevel, LEVELS } = require('../../scenarios/konductor/levels.js');

test('manifest.json is the generated file (run node bench/scenarios/konductor/manifest.js after a pack change)', () => {
  assert.equal(fs.readFileSync(MANIFEST_FILE, 'utf8'), render(buildManifest()));
});

test('every scenario of the pack is listed once, with exactly the levels levels.js picks it for', () => {
  const tasks = packTasks();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  assert.deepEqual(Object.keys(manifest.scenarios).sort(), tasks.map((t) => t.id).sort());
  for (const level of LEVELS) {
    const sel = selectLevel({ level, tasks });
    const listed = Object.keys(manifest.scenarios).filter((id) => manifest.scenarios[id].includes(level)).sort();
    assert.deepEqual(listed, sel.ids, level);
    assert.equal(manifest.listHashes[level], sel.listHash, level);
  }
});

test('render puts one scenario per line, levels in lite, standard, full order', () => {
  const text = render({ _comment: 'c', listHashes: { lite: 'a', standard: 'b', full: 'c' }, scenarios: { 'x-2': ['standard', 'full'], 'x-1': ['lite', 'standard', 'full'] } });
  const lines = text.split('\n');
  assert.ok(lines.includes('    "x-1": ["lite","standard","full"],'));
  assert.ok(lines.includes('    "x-2": ["standard","full"]'));
  assert.ok(lines.indexOf('    "x-1": ["lite","standard","full"],') < lines.indexOf('    "x-2": ["standard","full"]'));
  assert.deepEqual(JSON.parse(text).scenarios['x-2'], ['standard', 'full']);
});
