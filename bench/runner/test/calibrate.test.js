// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { cohenKappa, percentAgreement, spearman } = require('../../judge/agreement.js');
const { exportSheet, scoreLabels, formatCalibration } = require('../../judge/calibrate.js');
const { DEFAULTS } = require('../../judge/config.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const expand = (table) => table.flatMap(([a, b, n]) => Array.from({ length: n }, () => [a, b]));

test('cohenKappa matches the textbook 2x2 example (0.4)', () => {
  const pairs = expand([['yes', 'yes', 20], ['yes', 'no', 5], ['no', 'yes', 10], ['no', 'no', 15]]);
  near(cohenKappa(pairs), 0.4);
  near(percentAgreement(pairs), 0.7);
});

test('cohenKappa is 1 for identical labels, handles three classes, and is null without variance', () => {
  near(cohenKappa(expand([['pass', 'pass', 5], ['fail', 'fail', 5], ['partial', 'partial', 2]])), 1);
  // 3x3: po = 0.6, pe = 0.35 -> kappa = 0.25/0.65
  const pairs = expand([['pass', 'pass', 3], ['pass', 'partial', 1], ['partial', 'partial', 2], ['partial', 'fail', 1], ['fail', 'fail', 1], ['fail', 'pass', 2]]);
  near(percentAgreement(pairs), 6 / 10);
  near(cohenKappa(pairs), 0.25 / 0.65);
  assert.equal(cohenKappa(expand([['pass', 'pass', 4]])), null);
  assert.equal(cohenKappa([]), null);
});

test('spearman uses average ranks for ties', () => {
  near(spearman([1, 2, 3, 4], [1, 2, 2, 4]), 4.5 / Math.sqrt(22.5));
  near(spearman([1, 2, 3], [10, 20, 30]), 1);
  near(spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
  assert.equal(spearman([1], [1]), null);
});

function fixture(nRuns = 6) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const specs = [];
  for (let i = 1; i <= nRuns; i++) specs.push({ arm: i % 2 ? 'vanilla' : 'v1.2.0', rep: i, finalText: `answer ${i} from konductor`, files: { 'a.txt': `v${i}\n` } });
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  return { root, bench, runDir, specs };
}
const common = (f) => ({ runDir: f.runDir, benchDir: f.bench, limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });

test('export writes a blinded sheet, a separate key, and is deterministic for a seed', () => {
  const f = fixture();
  try {
    const out1 = path.join(f.root, 'cal1');
    const out2 = path.join(f.root, 'cal2');
    exportSheet({ ...common(f), n: 4, seed: 7, outDir: out1 });
    exportSheet({ ...common(f), n: 4, seed: 7, outDir: out2 });
    const sheet = JSON.parse(fs.readFileSync(path.join(out1, 'sheet.json'), 'utf8'));
    assert.equal(sheet.items.length, 4);
    assert.deepEqual(Object.keys(sheet.items[0].labels), ['c1', 'c2']);
    assert.ok(Object.values(sheet.items[0].labels).every((v) => v === null));
    const md = fs.readFileSync(path.join(out1, 'sheet.md'), 'utf8');
    for (const text of [JSON.stringify(sheet), md]) {
      assert.doesNotMatch(text, /vanilla|v1\.2\.0|konductor|armId/i);
      assert.match(text, /KEY: the seeded defect/);
    }
    const key = JSON.parse(fs.readFileSync(path.join(out1, 'key.json'), 'utf8'));
    assert.equal(Object.keys(key.items).length, 4);
    assert.ok(key.items[sheet.items[0].itemId].armId);
    assert.deepEqual(fs.readFileSync(path.join(out2, 'key.json'), 'utf8'), fs.readFileSync(path.join(out1, 'key.json'), 'utf8'));
    exportSheet({ ...common(f), n: 4, seed: 8, outDir: path.join(f.root, 'cal3') });
    assert.notEqual(fs.readFileSync(path.join(f.root, 'cal3/key.json'), 'utf8'), fs.readFileSync(path.join(out1, 'key.json'), 'utf8'));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('score compares judges to human labels and judges to each other, with PASS/WARN', () => {
  const f = fixture(6);
  try {
    const out = path.join(f.root, 'cal');
    exportSheet({ ...common(f), n: 6, seed: 1, outDir: out });
    const sheetFile = path.join(out, 'sheet.json');
    const sheet = JSON.parse(fs.readFileSync(sheetFile, 'utf8'));
    const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
    // Human: c1 alternates pass/fail by replicate parity, c2 always pass.
    const human = {};
    for (const it of sheet.items) {
      const k = key.items[it.itemId];
      human[`${k.armId}|${k.replicate}`] = k.replicate % 2 ? 'pass' : 'fail';
      it.labels = { c1: k.replicate % 2 ? 'pass' : 'fail', c2: 'pass' };
    }
    fs.writeFileSync(sheetFile, JSON.stringify(sheet));
    const rubric = [];
    for (let i = 1; i <= 6; i++) {
      const arm = i % 2 ? 'vanilla' : 'v1.2.0';
      const truth = i % 2 ? 'pass' : 'fail';
      const wrong = truth === 'pass' ? 'fail' : 'pass';
      const sc = (c1) => (c1 === 'pass' ? 1 : 0.75);
      rubric.push({ judge: 'good', arm, rep: i, criteria: { c1: truth, c2: 'pass' }, score: sc(truth) });
      rubric.push({ judge: 'bad', arm, rep: i, criteria: { c1: wrong, c2: 'fail' }, score: wrong === 'pass' ? 0.25 : 0 });
    }
    writeJudgments(f.runDir, { judges: ['bad', 'good'], rubric });
    const res = scoreLabels({ labelsFile: sheetFile, thresholds: DEFAULTS.thresholds });
    assert.equal(res.judges.good.status, 'PASS');
    near(res.judges.good.kappa, 1);
    near(res.judges.good.agreement, 1);
    near(res.judges.good.spearman, 1);
    assert.equal(res.judges.bad.status, 'WARN');
    assert.ok(res.judges.bad.agreement < 0.7);
    assert.equal(res.judges.good.nCriteria, 12);
    const jj = res.judgeVsJudge['bad~good'];
    assert.ok(jj.agreement < 0.7);
    assert.match(formatCalibration(res), /good.*PASS/s);
    assert.match(formatCalibration(res), /bad.*WARN/s);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('score skips unlabeled items and reports a judge with no data as WARN', () => {
  const f = fixture(2);
  try {
    const out = path.join(f.root, 'cal');
    exportSheet({ ...common(f), n: 2, seed: 1, outDir: out });
    writeJudgments(f.runDir, { judges: ['j'], rubric: [] });
    const res = scoreLabels({ labelsFile: path.join(out, 'sheet.json'), thresholds: DEFAULTS.thresholds });
    assert.equal(res.itemsLabeled, 0);
    assert.equal(res.judges.j.status, 'WARN');
    assert.equal(res.judges.j.kappa, null);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
