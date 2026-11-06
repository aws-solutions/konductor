// SPDX-License-Identifier: Apache-2.0
'use strict';

// The platform verdict as one page: the call per arm in plain words first, then the numbers behind it, the evidence
// that supports or limits it, every failed run, and the run directories it came from.

const C = require('./charts.js');
const D = require('./doc.js');
const { tone } = require('./build.js');
const { gradedTable } = require('./graded.js');
const { NEE } = require('./verdict.js');
const { checksModeNote } = require('./scores.js');
const { ruleLine } = require('./quotes.js');
const { verdictSensitivityBlocks } = require('./quotedoc.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const f = (v, d = 1) => (fin(v) ? v.toFixed(d) : 'n/a');
const ci = (lo, hi, d = 1) => (fin(lo) && fin(hi) ? ` [${f(lo, d)}, ${f(hi, d)}]` : '');
const signed = (v) => (fin(v) ? `${v > 0 ? '+' : ''}${f(v)}` : 'n/a');
const ratio = (o) => (fin(o.ratio) ? `${f(o.ratio, 2)}x${ci(o.ciLow, o.ciHigh, 2)}` : 'n/a');

function verdictCell(a) {
  return a.aaRepeatOf ? 'n/a (A/A repeat)' : a.verdict;
}

function noiseCell(n) {
  return n.available ? `${Math.max(...n.pairs.map((p) => p.cells || 0))} paired A/A cells, gap of the overall means ${f(n.spread)}, noise band +/-${f(n.pts)} points` : 'none measured';
}

const FAILED = ['checksFailed', 'timeout', 'error', 'infraError', 'modelMismatch'];

const RULES = [
  'KEEP needs a quality gain over the baseline that is larger than the A/A noise and whose paired 95% interval is above 0, at least 3 runs on each side, at least 5 paired task cells, at least 3 replicates in every cell, no anecdotal diligence rating, no clearly lower reliability, and a cost of at most 2.0x the baseline per successful run.',
  'DISCARD needs the same evidence for a quality loss. Its cost is not weighed: a loss is a loss at any price.',
  'When several arms are compared with the baseline, each quality interval is widened to the Bonferroni level 1 - 0.05/m for m arms (an A/A repeat is not an arm), and the page notes the level. The interval is paired by cell. A cell is one task in one run directory; each cell contributes the mean of the arm\'s scores minus the mean of the baseline\'s, and the 95% interval is a t interval on those differences. Runs of the same task are not independent, so an interval over pooled runs is shown only as a descriptive column. In a simulation with no true effect the paired interval excluded 0 in 4.1% to 6.5% of trials from 5 cells up, where the pooled one excluded it in 20% of trials at 3 runs a side.',
  'NOT ENOUGH EVIDENCE is the answer in every other case. It is forced when there are fewer than 3 runs on a side or fewer than 5 paired task cells, when the difference is inside the A/A noise, or when the diligence rating is anecdotal. It is also the answer when no A/A noise was measured, when a cell has fewer than 3 replicates, when the interval of the difference includes 0, when more than a fifth of the runs on a side have no score, when the arm and the baseline were scored on different components in any cell, or when a gain costs more than 2.0x.',
  `The A/A noise is pooled over every paired task cell of an arm and its repeat at the same commit: each cell gives the arm's mean quality minus the repeat's, and the noise is the larger end of the 95% interval of those differences, with a floor of ${f(5)} points. Two paired cells are the least that give it; with fewer there is no noise floor.`,
  'Efficiency is a ratio, never a 0 to 100 number: cost is credits per successful run, arm over baseline, and latency is mean wall clock over clean passes, arm over baseline. A ratio above 1 means the arm costs more.',
  'A failed or timed-out run counts as quality 0 when it has nothing to score, and counts against reliability. An infra error or model mismatch is left out of quality, listed, and capped at a fifth of the runs on a side.',
];

// Claude Code cells are costed in list-price USD, not credits.
const rulesFor = (v) => (v.harness === 'claude-code' ? RULES.map((r) => r.replace('cost is credits per successful run', 'cost is USD at list price per successful run')) : RULES);

function buildVerdictDocument(v) {
  const blocks = [];
  const charts = new Map();
  const heads = v.arms;
  const decided = heads.filter((a) => !a.aaRepeatOf);
  const unit = v.unit;

  blocks.push(D.h(1, 'Platform verdict: keep or discard'));
  blocks.push(D.p(`Baseline: ${v.baselineLabel}. ${decided.length} arm(s) compared on ${v.dirs.length} run director${v.dirs.length === 1 ? 'y' : 'ies'}. Arms are named by exact ref (name@commit). Cost is in ${unit === 'USD' ? 'USD at list price' : 'credits'} as metered.`));

  if (v.quote) blocks.push(D.p(ruleLine(v.quote, v.sensitivity?.available ? (v.sensitivity.anyDifferent ? 'at least one call differs, see the Sensitivity block below.' : 'no call differs, see the Sensitivity block below.') : 'not available.')));

  blocks.push(D.h(2, 'Verdict'));
  blocks.push(D.table(['arm', 'verdict', 'in plain words'], heads.map((a) => [a.label, verdictCell(a), a.sentence])));
  blocks.push(D.note('A verdict is only as good as the evidence behind it. The rules are at the end of this page.'));
  for (const n of v.notes) blocks.push(D.note(n));

  blocks.push(D.h(2, `Numbers against ${v.baselineLabel}`));
  blocks.push(D.table(
    ['arm', `Quality /100 (arm, ${v.baselineLabel})`, 'Difference in points [paired 95% CI]', 'Unpaired difference (descriptive, not used)', 'Reliability /100 (arm, baseline)', 'Autonomy /100 (arm, baseline)', `Cost ratio (${v.arms[0]?.cost.unit ?? unit} per successful run)`, 'Latency ratio (mean wall clock)'],
    heads.map((a) => [
      a.label, `${f(a.quality.value)}, ${f(a.quality.baseValue)}`, `${signed(a.quality.delta)}${ci(a.quality.deltaCiLow, a.quality.deltaCiHigh)}`, `${signed(a.quality.unpaired.delta)}${ci(a.quality.unpaired.ciLow, a.quality.unpaired.ciHigh)}`,
      `${f(a.reliability.value, 0)}, ${f(a.reliability.baseValue, 0)}`, a.autonomy ? `${f(a.autonomy.value, 0)}, ${f(a.autonomy.baseValue, 0)}` : 'n/a', ratio(a.cost), ratio(a.latency),
    ]),
  ));
  const rows = decided.filter((a) => fin(a.quality.delta)).map((a) => ({ label: a.label, delta: a.quality.delta, lo: a.quality.deltaCiLow, hi: a.quality.deltaCiHigh, n: a.quality.n, higherBetter: true }));
  const band = Math.max(0, ...decided.map((a) => (a.noise.available ? a.noise.pts : 0)));
  charts.set('verdict-quality', C.forestPlot({
    title: `Quality difference versus ${v.baselineLabel}`, id: 'verdict-quality', unit: 'quality points (arm minus baseline)',
    rows: rows.map((r) => ({ ...r, tone: tone(r.delta, r.lo, r.hi, band, true) })), noise: { lo: -band, hi: band, label: band ? `A/A noise +/-${f(band)} points` : 'no A/A noise measured' },
  }));
  blocks.push(D.chart('verdict-quality', charts.get('verdict-quality'), 'Forest plot of the quality difference of each arm against the baseline, with the A/A noise band'));

  blocks.push(D.h(2, 'How much evidence'));
  blocks.push(D.table(
    ['arm', 'runs (arm / baseline)', 'cells (task x directory)', 'replicates in the smallest cell', 'runs without a score (arm, baseline)', 'A/A noise', 'diligence rating', 'graded judge (arm, baseline; order disagreements)'],
    heads.map((a) => [
      a.label, `${a.quality.n} / ${a.quality.baseN}`, a.cells, a.minReps, `${a.nonScored.head.n} / ${a.nonScored.base.n}`, noiseCell(a.noise), a.diligence.rating,
      a.graded ? `${f(a.graded.armGrade, 2)}, ${f(a.graded.baseGrade, 2)}; ${a.graded.orderDisagreements} of ${a.graded.n}` : 'not run',
    ]),
  ));
  const anecdotal = decided.filter((a) => a.diligence.rating === 'anecdotal');
  if (anecdotal.length) blocks.push(D.note(`Anecdotal diligence rating: ${anecdotal.map((a) => a.label).join(', ')}. Each of these is NOT ENOUGH EVIDENCE whatever its numbers.`));

  blocks.push(D.h(2, 'Failed runs'));
  blocks.push(D.p('No run is dropped. These are the outcomes of every executed run of the arm on the cells it shares with the baseline; the last column counts runs that failed with nothing to score and so enter quality as 0.'));
  const baseLine = (o) => `${o.good} clean, ${FAILED.reduce((n, k) => n + o[k], 0)} failed`;
  blocks.push(D.table(
    ['arm', 'clean passes', 'checks failed', 'timeout', 'error', 'infra error', 'model mismatch', 'quality counted as 0', 'budget-skipped cells', `${v.baselineLabel} on the same cells`],
    heads.map((a) => [a.label, a.failures.good, a.failures.checksFailed, a.failures.timeout, a.failures.error, a.failures.infraError, a.failures.modelMismatch, a.failedAsZero, a.budgetSkipped, baseLine(a.baseFailures)]),
  ));
  blocks.push(D.note('Infra errors and model mismatches are not the arm\'s result: they are left out of the quality mean, counted against reliability and listed here.'));

  const gradedArms = heads.filter((a) => a.graded);
  if (gradedArms.length) {
    blocks.push(D.h(2, 'Graded judging (1 to 5)'));
    const summary = { arms: Object.fromEntries(gradedArms.map((a) => [a.label, { n: a.graded.n, errors: a.graded.errors, armGrade: a.graded.armGrade, baseGrade: a.graded.baseGrade, delta: a.graded.delta, orderDisagreements: a.graded.orderDisagreements, disagreementRate: a.graded.disagreementRate, shift: null }])), total: { disagreementRate: gradedArms.reduce((s, a) => s + a.graded.orderDisagreements, 0) / gradedArms.reduce((s, a) => s + a.graded.n, 0) } };
    const t = gradedTable(summary);
    blocks.push(D.table(t.head, t.rows));
    blocks.push(D.note(t.note));
  }

  blocks.push(...verdictSensitivityBlocks(v.sensitivity));

  blocks.push(D.h(2, 'Run directories'));
  const hasProfile = v.dirs.some((d) => d.profile);
  blocks.push(D.table(
    ['run directory', 'suite', 'diligence rating', 'executed runs', 'arms (exact refs)', v.harness === 'claude-code' ? 'cost (ledger)' : 'credits (ledger)', 'skill-study controls', ...(hasProfile ? ['profile check'] : [])],
    v.dirs.map((d) => [
      d.dir, d.suite ?? 'n/a', d.rating, d.runs, d.arms.join(', '),
      d.ledger ? `${f(d.ledger.total, 2)} ${unit === 'USD' ? 'USD' : 'credits'} (runs ${f(d.ledger.run, 2)}, judge ${f(d.ledger.judge, 2)})` : 'no ledger',
      d.controls ? (d.controls.trusted ? 'passed' : 'FAILED: do not trust skill verdicts') : 'not checked',
      ...(hasProfile ? [d.profile ? `profile ${d.profile.name}: ${d.profile.met ? 'met' : 'NOT MET'} (${d.profile.items.filter((i) => !i.ok).map((i) => i.text).join('; ') || 'nothing missing'})` : 'n/a'] : []),
    ]),
  ));

  blocks.push(D.h(2, 'Exact refs'));
  blocks.push(D.table(['arm', 'arm id', 'commit', 'tree or directory hash'], heads.map((a) => [a.label, a.armId, a.commitSha ?? 'none (no install)', a.contentHash ?? 'none'])));

  blocks.push(D.h(2, 'How to read this page'));
  blocks.push(D.list(rulesFor(v)));
  blocks.push(D.p(`Scoring weights come from profiles/scoring.json (hidden ${v.weights.hidden}, checks ${v.weights.checks}${checksModeNote(v.weights)}, rubric ${v.weights.rubric}); the formulas are in bench/README.md.`));
  blocks.push(D.note(`${NEE} is not a finding that the arm is no better. It means this study cannot say. More replicates, an A/A arm and judged output are what settle it.`));
  return { blocks, charts, title: 'Platform verdict' };
}

module.exports = { buildVerdictDocument };
