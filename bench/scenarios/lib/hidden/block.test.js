// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden test of a T8 document task, copied over the workspace root next to `block-kit/` (key.json, block-key.js).
// key.json: { "outputFile": "docs/incident.md", "items": [ {id, type, ...} ] } (item types: block-key.js).
// One test per key item, repeated `weight` times, so the share of passing tests is the weighted share of items met.
// BLOCK_KIT names another kit folder for the key (default `block-kit`), so a task with two documents can grade each
// with its own key: `BLOCK_KIT=rollout-kit node --test block.test.js` reads rollout-kit/key.json.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock, checkItem } = require('./block-kit/block-key.js');

const root = __dirname;
const { outputFile, items } = JSON.parse(fs.readFileSync(path.join(root, process.env.BLOCK_KIT || 'block-kit', 'key.json'), 'utf8'));
let text = '';
try { text = fs.readFileSync(path.join(root, outputFile), 'utf8'); } catch { /* a missing file fails every test */ }
const block = readBlock(text);

for (const item of items) {
  for (let i = 1; i <= (item.weight ?? 1); i++) {
    test(`${item.id}${item.weight > 1 ? ` #${i}` : ''}`, () => {
      assert.ok(block, `no JSON block in ${outputFile}`);
      const r = checkItem(block, item, root);
      assert.ok(r.pass, `${item.id}: ${r.detail}`);
    });
  }
}
