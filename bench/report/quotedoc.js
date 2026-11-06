// SPDX-License-Identifier: Apache-2.0
'use strict';

// The evidence-quote rule on a report page: the opening line, and the sensitivity tables that compare the rule in use with
// the other one. Pure block builders over the data from quotes.js.

const D = require('./doc.js');
const { ruleLine } = require('./quotes.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const f1 = (v) => (fin(v) ? v.toFixed(1) : 'n/a');
const f3 = (v) => (fin(v) ? v.toFixed(3) : 'n/a');
const pct = (v) => (fin(v) ? `${(100 * v).toFixed(1)}%` : 'n/a');
const capOf = (rule) => (rule === 'strict' ? 'strict' : 'lenient');

/** One sentence with the mean quality of every arm under both rules, for pages that have no table of their own. */
function inlineTail(sens) {
  if (!sens?.available) return 'not available.';
  const bits = sens.arms.map((a) => `${a.arm} ${f1(a.quality)} to ${f1(a.otherQuality)}`);
  return `mean quality per arm, ${capOf(sens.rule)} to ${capOf(sens.other)}: ${bits.join('; ')}${sens.orderDiffers ? '; the arm order DIFFERS' : '; the arm order is the same'}.`;
}

/** The judge table: downgrade rate under the rule in use and under the other one. */
function judgeTable(sens) {
  return D.table(
    ['judge', 'criteria', `downgraded, ${capOf(sens.rule)}`, `downgrade rate, ${capOf(sens.rule)}`, `downgraded, ${capOf(sens.other)}`, `downgrade rate, ${capOf(sens.other)}`],
    sens.judges.map((j) => [j.judge, j.criteria ?? 'n/a', j.downgraded ?? 'n/a', pct(j.rate), j.otherDowngraded ?? 'n/a', pct(j.otherRate)]),
    'Evidence quotes not found, per judge',
  );
}

/** The arm table: mean rubric (0..1) and quality (0..100) under both rules, with rank and a flip mark. */
function armTable(sens) {
  const mark = (a) => (a.flip ? `${a.rank} to ${a.otherRank} **FLIP**` : String(a.rank));
  return D.table(
    ['arm', 'runs', `rubric, ${capOf(sens.rule)}`, `rubric, ${capOf(sens.other)}`, `quality, ${capOf(sens.rule)}`, `quality, ${capOf(sens.other)}`, 'quality rank'],
    sens.arms.map((a) => [a.arm, a.runs, f3(a.rubric), f3(a.otherRubric), f1(a.quality), f1(a.otherQuality), mark(a)]),
    `Mean rubric (0 to 1) and quality (0 to 100) per arm under both rules (${capOf(sens.rule)} is the one in use)`,
  );
}

/** The page-opening line plus, for pages that show a table, the table. `tables`: 'none' | 'arms' | 'full'. */
function ruleBlocks(quote, sens, { tables = 'none', heading = 'Quote-rule sensitivity' } = {}) {
  if (!quote) return [];
  const blocks = [];
  const usable = Boolean(sens?.available);
  const tail = tables === 'none' || !usable ? inlineTail(sens) : (tables === 'full' ? 'see the Quote-rule sensitivity section below.' : 'see the table below.');
  blocks.push(D.p(ruleLine(quote, tail)));
  if (!usable || tables === 'none') return blocks;
  if (tables === 'arms') {
    blocks.push(armTable(sens));
    if (sens.warning) blocks.push(D.note(`Warning: ${sens.warning}`));
    return blocks;
  }
  return blocks;
}

/** The full report section. Empty when the other view is not available. */
function sensitivitySection(sens, { level = 2 } = {}) {
  if (!sens?.available) return [];
  const blocks = [D.h(level, 'Quote-rule sensitivity')];
  blocks.push(D.p(`The scores in this report use the ${capOf(sens.rule)} rule. The same judgments scored under the ${capOf(sens.other)} rule are shown beside them. Lenient raises the rubric component against strict, so a report made under one rule is not directly comparable with one made under the other.`));
  if (sens.judges.length) blocks.push(judgeTable(sens));
  blocks.push(armTable(sens));
  blocks.push(sens.warning ? D.note(`Warning: ${sens.warning}`) : D.p(`The arm order by quality is the same under both rules (${sens.order.join(' > ')}).`));
  return blocks;
}

const signed = (v) => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const interval = (a) => (fin(a.ciLow) && fin(a.ciHigh) ? `${signed(a.delta)} [${a.ciLow.toFixed(1)}, ${a.ciHigh.toFixed(1)}]${fin(a.level) ? ` at ${(a.level * 100).toFixed(1)}%` : ''}` : signed(a.delta));

/**
 * The verdict pages' block: the call under the other rule, the quality difference with its interval and the A/A band under
 * that rule, and whether the call is the same. `perCell` adds the cell column the orchestrator pass needs.
 */
function verdictSensitivityBlocks(sens, { perCell = false } = {}) {
  if (!sens) return [];
  const title = `Sensitivity: ${capOf(sens.other)} quote rule`;
  if (!sens.available) return [D.h(2, title), D.p(`Not available: ${sens.reason}.`)];
  const rows = sens.arms.map((a) => [
    ...(perCell ? [a.cell] : []), a.label, a.call, a.otherCall ?? 'n/a', interval(a), fin(a.noisePts) ? `${a.noisePts.toFixed(1)} points` : 'none measured', a.missing ? 'n/a' : a.same ? 'same call' : '**DIFFERENT CALL**',
  ]);
  const head = [...(perCell ? ['cell'] : []), 'arm', `call, ${capOf(sens.rule)} (in use)`, `call, ${capOf(sens.other)}`, `quality difference [interval], ${capOf(sens.other)}`, `A/A band, ${capOf(sens.other)}`, 'compared'];
  return [
    D.h(2, title),
    D.p(`The same judgments scored under the ${capOf(sens.other)} rule, run through the same rules. ${sens.anyDifferent ? 'At least one call depends on the quote rule.' : 'No call depends on the quote rule.'}`),
    D.table(head, rows),
  ];
}

module.exports = { ruleBlocks, sensitivitySection, inlineTail, judgeTable, armTable, verdictSensitivityBlocks };
