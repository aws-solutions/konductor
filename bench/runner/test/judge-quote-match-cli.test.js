// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js judge --quote-match on a normal pass: both views are written, the rule is printed, and the pack pass refuses the flag.
// These tests start bench.js, so run them when no other bench process is running.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;
const rm = (root) => fs.rmSync(root, { recursive: true, force: true });

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla' }, { arm: 'k' }]);
  const base = ['judge', '--run', runDir, '--bench-dir', bench, '--judges', 'gpt-test', '--judge-cmd', FAKE, '--allow-small-panel'];
  return { root, runDir, base };
}
const run = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8' });

test('a judge pass records both views and prints the default rule', () => {
  const s = setup();
  try {
    const r = run([...s.base, '--mode', 'rubric']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /evidence-quote rule recorded as the default: lenient \(tightened: quotes with 20 or more unsupported letters are rejected\)/);
    const j = JSON.parse(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8'));
    const rec = j.rubric[0];
    assert.equal(rec.quoteRule, 'lenient');
    assert.ok(rec.criteria.every((c) => c.quoteFound && 'verdictStrict' in c && 'verdictLenient' in c));
  } finally { rm(s.root); }
});

test('--quote-match strict makes the older fields strict; an unknown rule is refused; the pack pass refuses the flag', () => {
  const s = setup();
  try {
    const r = run([...s.base, '--mode', 'rubric', '--quote-match', 'strict']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /recorded as the default: strict \(every segment between ellipses must appear in the output, in order\)/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.runDir, 'judgments.json'), 'utf8')).rubric[0].quoteRule, 'strict');
    const bad = run([...s.base, '--quote-match', 'loose']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--quote-match takes strict or lenient/);
    const pack = run([...s.base, '--criteria-pack', 'quality', '--quote-match', 'strict']);
    assert.notEqual(pack.status, 0);
    assert.match(pack.stderr, /--quote-match does not apply with --criteria-pack/);
  } finally { rm(s.root); }
});
