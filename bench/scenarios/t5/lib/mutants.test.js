// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMutants } = require('./mutants.js');

function build(testSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't5mt-'));
  const ws = path.join(root, 'ws'), hid = path.join(root, 'hid');
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'test'));
  fs.writeFileSync(path.join(ws, 'src/add.js'), 'exports.add = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(ws, 'test/add.test.js'), testSrc);
  fs.mkdirSync(path.join(hid, 'pristine/src'), { recursive: true });
  fs.writeFileSync(path.join(hid, 'pristine/src/add.js'), 'exports.add = (a, b) => a + b;\n');
  for (const [id, body] of [['m1', 'a - b'], ['m2', 'a + b + 1'], ['m3', 'while (true) {}']]) {
    fs.mkdirSync(path.join(hid, 'mutants', id, 'src'), { recursive: true });
    fs.writeFileSync(path.join(hid, 'mutants', id, 'src/add.js'), `exports.add = (a, b) => { ${body.startsWith('while') ? body : `return ${body};`} };\n`);
  }
  fs.writeFileSync(path.join(hid, 'mutants.json'), JSON.stringify({
    runner: 'node', testCmd: 'node --test --test-timeout=2000 test/**/*.test.js', pristine: ['src/add.js'],
    mutants: ['m1', 'm2', 'm3'].map((id) => ({ id, files: ['src/add.js'] })),
  }));
  return { root, ws, hid };
}

const STRONG = "const t=require('node:test'),a=require('node:assert'),{add}=require('../src/add.js');t('adds',()=>{a.strictEqual(add(2,3),5);a.strictEqual(add(0,0),0)});\n";
const WEAK = "const t=require('node:test'),a=require('node:assert'),{add}=require('../src/add.js');t('adds',()=>{a.ok(typeof add(1,1)==='number')});\n";
const BROKEN = "const t=require('node:test'),a=require('node:assert');t('x',()=>a.fail('no'));\n";

test('a strong test kills every mutant, a hang counts as killed', () => {
  const b = build(STRONG);
  try { const r = runMutants(b.ws, b.hid, { suiteTimeoutMs: 4000 }); assert.deepStrictEqual([r.realPass, r.killed, r.total, r.score], [true, 3, 3, 1]); }
  finally { fs.rmSync(b.root, { recursive: true, force: true }); }
});

test('a weak test kills only the hang', () => {
  const b = build(WEAK);
  try { const r = runMutants(b.ws, b.hid, { suiteTimeoutMs: 4000 }); assert.strictEqual(r.killed, 1); assert.strictEqual(r.results[2].detail.startsWith('killed'), true); }
  finally { fs.rmSync(b.root, { recursive: true, force: true }); }
});

test('tests that fail on the real code score zero', () => {
  const b = build(BROKEN);
  try { const r = runMutants(b.ws, b.hid, { suiteTimeoutMs: 4000 }); assert.strictEqual(r.realPass, false); assert.strictEqual(r.score, 0); }
  finally { fs.rmSync(b.root, { recursive: true, force: true }); }
});

test('agent edits to the real source are undone before the run', () => {
  const b = build(STRONG);
  try { fs.writeFileSync(path.join(b.ws, 'src/add.js'), 'exports.add = () => 5;\n'); assert.strictEqual(runMutants(b.ws, b.hid, { suiteTimeoutMs: 4000 }).score, 1); }
  finally { fs.rmSync(b.root, { recursive: true, force: true }); }
});
