// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { openLedger, readLedger, guardState, LEDGER_FILE, SOFT_STOP } = require('../lib/credit-ledger.js');

const lines = (dir) => fs.readFileSync(path.join(dir, LEDGER_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('guardState: no budget never stops; 90% stops new work; 100% is a hard stop', () => {
  assert.equal(SOFT_STOP, 0.9);
  assert.equal(guardState(1e9, null), 'ok');
  assert.equal(guardState(89.99, 100), 'ok');
  assert.equal(guardState(90, 100), 'stop');
  assert.equal(guardState(99.9, 100), 'stop');
  assert.equal(guardState(100, 100), 'hard');
  assert.equal(guardState(250, 100), 'hard');
});

test('every record is appended as one JSON line with a time, a kind and the credits', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir });
    l.record({ kind: 'run', credits: 2.5, arm: 'vanilla', task: 't1', replicate: 1 });
    l.record({ kind: 'judge', credits: 0.4, judge: 'glm-5', cached: false });
    const [a, b] = lines(dir);
    assert.equal(a.kind, 'run');
    assert.equal(a.credits, 2.5);
    assert.equal(a.arm, 'vanilla');
    assert.match(a.at, /^\d{4}-\d\d-\d\dT/);
    assert.equal(b.kind, 'judge');
    assert.equal(b.judge, 'glm-5');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('totals split runs from judge calls and add up; this command is counted apart from the study', () => {
  const dir = tmp();
  try {
    const first = openLedger({ dir });
    first.record({ kind: 'run', credits: 10 });
    first.record({ kind: 'run', credits: 5 });
    const second = openLedger({ dir });
    second.record({ kind: 'judge', credits: 3 });
    const t = second.totals();
    assert.deepEqual([t.run, t.judge, t.total, t.session], [15, 3, 18, 3]);
    assert.equal(t.calls, 3);
    assert.match(second.line(), /this command 3\.00.*study total 18\.00.*runs 15\.00.*judge 3\.00/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a record with unknown credits is kept, counted as unknown and adds 0', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir });
    l.record({ kind: 'run', credits: null, arm: 'a' });
    const t = l.totals();
    assert.equal(t.total, 0);
    assert.equal(t.unknown, 1);
    assert.equal(lines(dir)[0].credits, null);
    assert.match(l.line(), /1 call\(s\) with unknown credits/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a censored run is totalled at its charge, not at its lower-bound credits', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir });
    l.record({ kind: 'run', credits: 0.2, charged: 1.5, censored: true });
    assert.equal(l.totals().total, 1.5);
    assert.equal(l.totals().unknown, 0);
    assert.equal(lines(dir)[0].credits, 0.2, 'the observed figure is kept in the file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with no budget the guard never stops, however much is spent', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir });
    l.record({ kind: 'run', credits: 1e6 });
    assert.equal(l.state(), 'ok');
    assert.equal(l.shouldStop(), false);
    assert.match(l.line(), /no cap/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('with a budget the guard counts only this command and reports 90% and 100%', () => {
  const dir = tmp();
  try {
    openLedger({ dir }).record({ kind: 'run', credits: 500 });
    const l = openLedger({ dir, budget: 100 });
    assert.equal(l.state(), 'ok', 'earlier spend in the same directory is not charged to this command');
    l.record({ kind: 'judge', credits: 89 });
    assert.equal(l.state(), 'ok');
    l.record({ kind: 'judge', credits: 1 });
    assert.equal(l.state(), 'stop');
    assert.equal(l.shouldStop(), true);
    assert.match(l.stopReason(), /90% of the 100-credit guard/);
    l.record({ kind: 'judge', credits: 10 });
    assert.equal(l.state(), 'hard');
    assert.match(l.stopReason(), /100% of the 100-credit guard/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readLedger tolerates a missing file and counts lines it cannot read', () => {
  const dir = tmp();
  try {
    assert.deepEqual(readLedger(dir), { file: path.join(dir, LEDGER_FILE), exists: false, entries: [], bad: 0, totals: { run: 0, judge: 0, other: 0, total: 0, calls: 0, unknown: 0 } });
    fs.writeFileSync(path.join(dir, LEDGER_FILE), `${JSON.stringify({ kind: 'run', credits: 2 })}\nnot json\n${JSON.stringify({ kind: 'draft', credits: 1 })}\n`);
    const r = readLedger(dir);
    assert.equal(r.bad, 1);
    assert.deepEqual([r.totals.run, r.totals.other, r.totals.total], [2, 1, 3]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a failed write never throws into a run, it is counted', () => {
  const l = openLedger({ dir: path.join(tmp(), 'missing', 'deeper', 'x'), create: false });
  assert.doesNotThrow(() => l.record({ kind: 'run', credits: 1 }));
  assert.equal(l.totals().writeFailures, 1);
  assert.equal(l.totals().total, 1, 'the in-memory total still includes it');
});
