// SPDX-License-Identifier: Apache-2.0
'use strict';

// The platform verdict compares every arm with the baseline. With m arms compared, each paired interval is widened to
// level 1 - 0.05/m (Bonferroni), so the chance that any of them excludes 0 by luck stays near 5 percent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const stats = require('../../report/stats.js');
const V = require('../../report/verdict.js');
const op = require('../../report/orchpass.js');
const { buildVerdictDocument } = require('../../report/verdictdoc.js');
const { toMarkdown } = require('../../report/doc.js');

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NEE = 'NOT ENOUGH EVIDENCE';

test('tQuantile reproduces the two-sided 95% table and the 97.5% and 99% values', () => {
  const table = { 1: 12.706, 2: 4.303, 5: 2.571, 10: 2.228, 30: 2.042, 120: 1.98 };
  for (const [df, q] of Object.entries(table)) assert.ok(Math.abs(stats.tQuantile(0.975, Number(df)) - q) < 0.002, `df ${df}`);
  assert.ok(Math.abs(stats.tQuantile(0.9875, 5) - 3.163) < 0.005, String(stats.tQuantile(0.9875, 5)));
  assert.ok(Math.abs(stats.tQuantile(0.995, 10) - 3.169) < 0.005);
  assert.ok(Math.abs(stats.tQuantile(0.5, 7)) < 1e-9);
  assert.ok(stats.tQuantile(0.99, 5) > stats.tQuantile(0.975, 5));
});

test('pairedCellCI widens with the number of comparisons, keeps 95% for one, and adjusts p', () => {
  const cells = [[1, 4, 1, 3, 1, 3]].flatMap((ds) => ds.map((d) => ({ head: [4 + d], base: [4] })));
  const one = stats.pairedCellCI(cells);
  const same = stats.pairedCellCI(cells, { comparisons: 1 });
  assert.deepEqual(same, one, 'one comparison is the 95% interval, unchanged');
  assert.equal(one.level, 0.95);
  const three = stats.pairedCellCI(cells, { comparisons: 3 });
  assert.ok(Math.abs(three.level - (1 - 0.05 / 3)) < 1e-12);
  assert.equal(three.comparisons, 3);
  assert.ok(three.ciHigh - three.ciLow > one.ciHigh - one.ciLow);
  assert.equal(three.delta, one.delta);
  assert.ok(Math.abs(three.pAdjusted - Math.min(1, three.p * 3)) < 1e-12);
  assert.ok(stats.pairedCellCI(cells, { comparisons: 40 }).pAdjusted <= 1);
});

// diffs in hidden tests of each task, arm minus vanilla: [0, 4, 1, 3, 1, 3] -> t of about 3.2 over 6 cells
const HID = { t1: 4, t2: 8, t3: 5, t4: 7, t5: 5, t6: 7 };
const arm = (sha) => ({ [sha]: { sha, hiddenByTask: HID, credits: 1.5 }, [`${sha}-b`]: { sha, hiddenByTask: HID, credits: 1.5 } });
const vanilla = { vanilla: { hidden: [4], credits: 1 } };
const verdict = (root, name, arms) => {
  const { dir, benchDir } = fixtureRun(root, name, { arms, tasks: TASKS6 });
  return V.buildVerdict({ dirs: [dir], benchDir });
};

test('one arm with a t of about 3.2 is a KEEP at 95%', () => {
  const root = mk();
  try {
    const v = verdict(root, 'one', { ...vanilla, ...arm('a') });
    const a = v.arms.find((x) => x.label === 'a@aaaaaaa');
    assert.equal(a.verdict, 'KEEP', a.reason);
    assert.equal(a.quality.level, 0.95);
    assert.equal(v.comparisons, 1);
  } finally { rm(root); }
});

test('the same arm among three compared arms is NOT ENOUGH EVIDENCE: its interval is at the Bonferroni level', () => {
  const root = mk();
  try {
    const v = verdict(root, 'three', { ...vanilla, ...arm('a'), ...arm('b'), ...arm('c') });
    assert.equal(v.comparisons, 3);
    for (const label of ['a@aaaaaaa', 'b@bbbbbbb', 'c@ccccccc']) {
      const a = v.arms.find((x) => x.label === label);
      assert.equal(a.verdict, NEE, a.reason);
      assert.match(a.reason, /paired 98\.3% interval of the quality difference \[.*\] includes 0/);
      assert.ok(Math.abs(a.quality.level - (1 - 0.05 / 3)) < 1e-12);
      assert.ok(a.quality.deltaCiLow < 0);
    }
    assert.ok(v.notes.some((n) => /3 arms are compared.*98\.3%/.test(n)), v.notes.join(' | '));
  } finally { rm(root); }
});

test('an A/A repeat is not a comparison', () => {
  const root = mk();
  try {
    const v = verdict(root, 'aa', { ...vanilla, ...arm('a'), ...arm('b') });
    assert.equal(v.comparisons, 2, 'a and b; a-b and b-b are repeats');
  } finally { rm(root); }
});

test('a very large effect still survives the adjustment', () => {
  const root = mk();
  try {
    const big = { ...arm('a'), ...arm('b'), ...arm('c') };
    for (const k of ['a', 'a-b']) big[k].hiddenByTask = { t1: 10, t2: 10, t3: 10, t4: 10, t5: 10, t6: 10 };
    const v = verdict(root, 'big', { ...vanilla, ...big });
    assert.equal(v.arms.find((x) => x.label === 'a@aaaaaaa').verdict, 'KEEP');
  } finally { rm(root); }
});

test('the verdict page names the number of comparisons and the adjusted level', () => {
  const root = mk();
  try {
    const v = verdict(root, 'doc', { ...vanilla, ...arm('a'), ...arm('b'), ...arm('c') });
    const md = toMarkdown(buildVerdictDocument(v).blocks);
    assert.match(md, /3 arms are compared with the baseline.*Bonferroni level of 98\.3%/);
    assert.match(md, /paired 98\.3% interval of the quality difference/);
  } finally { rm(root); }
});

test('orchestrator pass rule: the quality interval of an arm among several is at the adjusted level', () => {
  const root = mk();
  try {
    const meta = { model: 'claude-sonnet-5.5', agentEngine: 'v3', harness: 'kiro-cli' };
    const mk2 = (sha) => ({ [sha]: { sha, hiddenByTask: HID, credits: 5, extra: meta }, [`${sha}-b`]: { sha, hiddenByTask: HID, credits: 5, extra: meta } });
    const run = (arms) => {
      const fx = fixtureRun(root, `o${Object.keys(arms).length}`, { arms: { vanilla: { hidden: [4, 4, 5, 3, 4], credits: 5, extra: meta }, ...arms }, tasks: TASKS6, config: { model: meta.model, agentEngine: 'v3', harness: 'kiro-cli' } });
      return op.buildOrchestratorPass({ dirs: [fx.dir], benchDir: fx.benchDir, baseline: 'vanilla' });
    };
    const alone = run(mk2('a')).cells[0].arms.find((x) => x.armId === 'a');
    const among = run({ ...mk2('a'), ...mk2('b'), ...mk2('c') });
    const a3 = among.cells[0].arms.find((x) => x.armId === 'a');
    assert.equal(among.comparisons, 3);
    assert.ok(a3.quality.deltaCiLow < alone.quality.deltaCiLow);
    assert.equal(a3.quality.level.toFixed(4), (1 - 0.05 / 3).toFixed(4));
  } finally { rm(root); }
});
