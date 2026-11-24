'use strict';
// SPDX-License-Identifier: Apache-2.0
// bench/ops/next-experiment-2026-11-22/rescore-table.js (the TSV rescore-cc.sh writes) on a two-phase stub copy:
// one run, saved checks under checksOriginal, rechecked before and after with the newest key. Free: no model call.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const OPS = path.join(__dirname, '..', '..', 'ops', 'next-experiment-2026-11-22');
const BENCH = path.join(__dirname, '..', '..');

test('rescore-table.js: one TSV line per run with saved, before and after scores and hidden counts', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rescore-table-'));
  try {
    const hidden = (passed, total) => ({ type: 'tests', scored: true, pass: passed === total, tests: { passed, total } });
    const write = (phase, result) => {
      const d = path.join(out, 'runs', phase, 'cc', 't8-x', 'cc-konductor', 't8-x', '1');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify(result));
    };
    write('before', { status: 'success', checksOriginal: [hidden(1, 4)], checks: [hidden(2, 4)] });
    write('after', { status: 'success', checks: [hidden(4, 4)] });
    const r = spawnSync(process.execPath, [path.join(OPS, 'rescore-table.js'), out, BENCH], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trim().split('\n').map((l) => l.split('\t'));
    assert.deepStrictEqual(lines[0], ['setup', 'task', 'arm', 'rep', 'saved', 'before', 'after', 'hiddenSaved', 'hiddenBefore', 'hiddenAfter', 'status']);
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(lines[1].slice(0, 4), ['cc', 't8-x', 'cc-konductor', '1']);
    assert.deepStrictEqual(lines[1].slice(7), ['1/4', '2/4', '4/4', 'success']);
    const [saved, before, after] = lines[1].slice(4, 7).map(Number);
    assert.ok(saved < before && before < after, `scores rise with the hidden counts: ${lines[1].join(' ')}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('rescore-cc.sh calls the versioned rescore-table.js next to it, not a workspace copy', () => {
  const sh = fs.readFileSync(path.join(OPS, 'rescore-cc.sh'), 'utf8');
  assert.match(sh, /node "\$HERE0\/rescore-table\.js"/);
  assert.doesNotMatch(sh, /task-key-fixes-2026-11-24-scripts/);
});
