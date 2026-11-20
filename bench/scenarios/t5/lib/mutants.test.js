// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMutants } = require('../../lib/hidden/mutants.js');

function build(testSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't5mt-'));
  const ws = path.join(root, 'ws'), hid = path.join(root, 'hid');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'));
  fs.writeFileSync(path.join(ws, 'src/add.js'), 'exports.add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(ws, 'test/add.test.js'), testSrc);
  fs.mkdirSync(path.join(hid, 'pristine/src'), { recursive: true });
  fs.writeFileSync(path.join(hid, 'pristine/src/add.js'), 'exports.add = (a, b) => a + b;\n');
  for (const [id, body] of [['m1', 'return a - b;'], ['m2', 'return a + b + 1;'], ['m3', 'while (true) {}']]) {
    fs.mkdirSync(path.join(hid, 'mutants', id, 'src'), { recursive: true });
    fs.writeFileSync(path.join(hid, 'mutants', id, 'src/add.js'), `exports.add = (a, b) => { ${body} };\n`);
  }
  fs.writeFileSync(path.join(hid, 'mutants.json'), JSON.stringify({
    runner: 'node', testCmd: 'node --test --test-timeout=2000 test/add.test.js', pristine: ['src/add.js'],
    mutants: ['m1', 'm2', 'm3'].map((id) => ({ id, files: ['src/add.js'] })),
  }));
  return { root, ws, hid };
}

const STRONG = "const t=require('node:test'),a=require('node:assert'),{add}=require('../src/add.js');t('adds',()=>{a.strictEqual(add(2,3),5);a.strictEqual(add(0,0),0)});\n";
const WEAK = "const t=require('node:test'),a=require('node:assert'),{add}=require('../src/add.js');t('adds',()=>{a.ok(typeof add(1,1)==='number')});\n";
const BROKEN = "const t=require('node:test'),a=require('node:assert');t('x',()=>a.fail('no'));\n";
const OPTS = { suiteTimeoutMs: 4000 };

function withBuild(src, fn) {
  const b = build(src);
  try { fn(b); } finally { fs.rmSync(b.root, { recursive: true, force: true }); }
}

test('a strong test kills every mutant, a hang counts as killed', () => withBuild(STRONG, (b) => {
  const r = runMutants(b.ws, b.hid, OPTS);
  assert.deepStrictEqual([r.realPass, r.killed, r.total, r.score], [true, 3, 3, 1]);
}));

test('a weak test kills only the hang', () => withBuild(WEAK, (b) => {
  const r = runMutants(b.ws, b.hid, OPTS);
  assert.strictEqual(r.killed, 1);
  assert.ok(r.results[2].killed);
}));

test('tests that fail on the real code score zero', () => withBuild(BROKEN, (b) => {
  const r = runMutants(b.ws, b.hid, OPTS);
  assert.deepStrictEqual([r.realPass, r.score], [false, 0]);
}));

test('agent edits to the real source are undone before the run', () => withBuild(STRONG, (b) => {
  fs.writeFileSync(path.join(b.ws, 'src/add.js'), 'exports.add = () => 5;\n');
  assert.strictEqual(runMutants(b.ws, b.hid, OPTS).score, 1);
}));

// A suite that pins the source text "kills" every mutant; a safe refactor shows it tells nothing about behaviour.
const PINNED = "const t=require('node:test'),a=require('node:assert'),fs=require('node:fs');t('pins',()=>a.ok(fs.readFileSync(__dirname+'/../src/add.js','utf8')==='exports.add = (a, b) => a + b;\\n'));\n";

function withRefactor(src, fn, extra = {}) {
  withBuild(src, (b) => {
    fs.mkdirSync(path.join(b.hid, 'refactors/r1/src'), { recursive: true });
    fs.writeFileSync(path.join(b.hid, 'refactors/r1/src/add.js'), 'function plus(x, y) { return x + y; }\nexports.add = plus;\n');
    const cfg = JSON.parse(fs.readFileSync(path.join(b.hid, 'mutants.json'), 'utf8'));
    fs.writeFileSync(path.join(b.hid, 'mutants.json'), JSON.stringify({ ...cfg, refactors: [{ id: 'r1', files: ['src/add.js'] }], ...extra }));
    fn(b);
  });
}

test('a suite that pins the source fails the safe refactor and scores zero', () => withRefactor(PINNED, (b) => {
  const r = runMutants(b.ws, b.hid, OPTS);
  assert.deepStrictEqual([r.realPass, r.refactorsPass, r.killed, r.score], [true, false, 3, 0]);
}));

test('a behaviour test passes the safe refactor and keeps its kills', () => withRefactor(STRONG, (b) => {
  const r = runMutants(b.ws, b.hid, OPTS);
  assert.deepStrictEqual([r.refactorsPass, r.score], [true, 1]);
}));

test('countTests counts test definitions in the workspace test files', () => withRefactor(STRONG + "t('two',()=>{});it ('three',()=>{});\n", (b) => {
  const { prepare, countTests, cleanup } = require('../../lib/hidden/mutants.js');
  const ctx = prepare(b.ws, b.hid, OPTS);
  try { assert.strictEqual(countTests(ctx), 1); } finally { cleanup(ctx); }
}));
