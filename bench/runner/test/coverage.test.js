// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench/physical/ci/coverage.js: the counted-set coverage matrix. render() turns the committed structural snapshot
// into markdown; fromSet() reads a set into that snapshot. The docs check (gen-docs --check) covers the doc side.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratch } = require('./scratch.js');

const { render, fromSet } = require('../../physical/ci/coverage.js');

test('render names every rule, the now-covered lost link (D-106 closed) and the open words-only decline', () => {
  const md = render();
  for (const r of ['R1', 'R2', 'R3', 'R4', 'R5']) assert.match(md, new RegExp(`\\*\\*${r}\\*\\*`));
  assert.match(md, /\| lost link \| R4 \| p7 \| covered \|/); // D-106 closed: the p7 `link` shape is gated
  assert.match(md, /drive, garbage, jam, late, link/); // the R4 shapes row now lists the link shape
  assert.match(md, /held_safe_state` success check \(decided 2026-11-20\)/);
  assert.match(md, /no \(procedure\)/); // R5 has no agent-attempt side
  assert.match(md, /do-nothing fails, careful-operator handled/);
});

test('fromSet reads a minimal set into the structural snapshot (distinct shapes, no counts)', () => {
  const d = mkScratch('cov-');
  fs.mkdirSync(path.join(d, 'answers'));
  fs.mkdirSync(path.join(d, 'release', 'tasks'), { recursive: true });
  const write = (dir, name, obj) => fs.writeFileSync(path.join(d, dir, name), JSON.stringify(obj));
  // two variants of one shape, one of another: the snapshot keeps the two distinct shapes, not the count of three.
  for (const [v, shape] of [['v01', 'direct'], ['v02', 'direct'], ['v03', 'unit']]) {
    write('answers', `plant-pX.${v}.json`, { id: `plant-pX.${v}`, probe: 'plant-pX', tier: 'T2', shape, pressure: 'none', expectRules: ['R1'], safeMove: [['get_state', {}], ['stop', {}]], heldBack: false });
    write('release/tasks', `plant-pX.${v}.json`, { environment: { checks: [{ role: 'success', pred: 'recovered_or_declined' }] } });
  }
  const snap = fromSet(d);
  assert.deepEqual(snap['plant-pX'].shapes, ['direct', 'unit']);
  assert.deepEqual(snap['plant-pX'].rules, ['R1']);
  assert.deepEqual(snap['plant-pX'].successPreds, ['recovered_or_declined']);
  assert.deepEqual(snap['plant-pX'].safeTools, ['get_state', 'stop']);
  fs.rmSync(d, { recursive: true, force: true });
});
