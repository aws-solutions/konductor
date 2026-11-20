// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T8 document task, copied over the workspace root next to `block-kit/` (key.json, block-key.js).
// key.json: { "outputFile": "docs/incident.md", "items": [ {id, type, ...} ], "scoring"?: "sections" } (item types: block-key.js).
// Default: one test per key item, repeated `weight` times, so the share of passing tests is the weighted share of items met.
// "scoring": "sections": every item names a `section`; each section gives two tests, "complete" (no item missed) and
// "nearly complete" (at most one missed), so a section earns all, half or nothing and half a report earns little.
// An item with `gate: true` (the root cause, the decision) fails every test when it fails: a wrong call earns nothing.
// BLOCK_KIT names another kit folder for the key (default `block-kit`), so a task with two documents can grade each
// with its own key: `BLOCK_KIT=rollout-kit node --test block.test.js` reads rollout-kit/key.json.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock, checkItem, sectionResults } = require('./block-kit/block-key.js');

const root = __dirname;
const key = JSON.parse(fs.readFileSync(path.join(root, process.env.BLOCK_KIT || 'block-kit', 'key.json'), 'utf8'));
const { outputFile, items } = key;
let text = '';
try { text = fs.readFileSync(path.join(root, outputFile), 'utf8'); } catch { /* a missing file fails every test */ }
const block = readBlock(text);
const gates = items.filter((it) => it.gate);
const gateFailure = () => {
  for (const g of gates) {
    const r = checkItem(block, g, root);
    if (!r.pass) return `gate ${g.id} failed: ${r.detail}`;
  }
  return null;
};

if (key.scoring === 'sections') {
  for (const s of sectionResults(block, items, root)) {
    for (const [name, maxMissed] of [['complete', 0], ['nearly complete', 1]]) {
      test(`section ${s.section} ${name}`, () => {
        assert.ok(block, `no JSON block in ${outputFile}`);
        const g = gateFailure();
        assert.ok(!g, g);
        assert.ok(s.missed.length <= maxMissed, `${s.section}: missed ${s.missed.join(', ')}`);
      });
    }
  }
} else {
  for (const item of items) {
    for (let i = 1; i <= (item.weight ?? 1); i++) {
      test(`${item.id}${item.weight > 1 ? ` #${i}` : ''}`, () => {
        assert.ok(block, `no JSON block in ${outputFile}`);
        const g = gateFailure();
        assert.ok(!g, g);
        const r = checkItem(block, item, root);
        assert.ok(r.pass, `${item.id}: ${r.detail}`);
      });
    }
  }
}
