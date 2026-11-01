// SPDX-License-Identifier: Apache-2.0
'use strict';

// The orchestrator pass page: the rule, one call per cell and arm in plain words, the numbers behind each call, the GPT
// ratio comparison, the orchestration figures, every failed run, and the definitions.

const D = require('./doc.js');
const { NEE } = require('./orchpass.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const f = (v, d = 1) => (fin(v) ? v.toFixed(d) : v === Infinity ? 'unbounded' : 'n/a');
const x = (v) => (fin(v) ? `${v.toFixed(2)}x` : v === Infinity ? 'unbounded' : 'n/a');
const signed = (v) => (fin(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (v) => (fin(v) ? `${(v * 100).toFixed(0)}%` : 'n/a');

function sentence(a) {
  if (a.aaRepeatOf) return `A/A repeat of ${a.aaRepeatOf}. It measures drift and gets no call.`;
  if (a.call === 'PASS') return `Passes. It costs ${x(a.cost.ratioPerRun)} vanilla per run and ${x(a.cost.ratioPerSuccess)} per successful run (limit 2.0x), and its quality is ${signed(a.quality.delta)} points against vanilla (one vanilla run varies by ${f(a.quality.baseSd)}).`;
  if (a.call === 'FAIL') return `Fails. ${a.reasons.map(cap).join('. ')}.`;
  return `${NEE}. ${a.reasons.map(cap).join('. ')}.${a.rawPass === true ? ' On the raw thresholds alone it would pass.' : a.rawPass === false ? ' On the raw thresholds alone it would fail.' : ''}`;
}

function buildOrchestratorPassDocument(v) {
  const blocks = [];
  blocks.push(D.h(1, 'Orchestrator pass rule'));
  blocks.push(D.p(`Baseline: ${v.baseline}. ${v.cells.length} cell(s), keyed by harness and model. A test arm passes in a cell when it costs at most 2.0x vanilla and its quality is within one vanilla run of vanilla. Cost is in ${v.unit}.`));

  blocks.push(D.h(2, 'Calls'));
  const rows = [];
  for (const c of v.cells) for (const a of c.arms) rows.push([c.key, a.label, a.aaRepeatOf ? 'n/a (A/A repeat)' : a.call, sentence(a)]);
  blocks.push(D.table(['cell (harness / model)', 'arm', 'call', 'in plain words'], rows));
  for (const n of v.notes) blocks.push(D.note(n));

  for (const c of v.cells) {
    blocks.push(D.h(2, `Cell: ${c.key}`));
    blocks.push(D.p(`Baseline ${c.baselineLabel}. Run directories: ${c.dirs.join(', ')}.`));
    const aaText = c.aa.available ? `A/A drift: quality ${f(c.aa.qualityDrift)} points, cost ${fin(c.aa.costDrift) ? pct(c.aa.costDrift) : 'n/a'}. ${c.aa.pairs.map((p) => `${p.arm}: ${f(p.qualityA)} vs ${f(p.qualityB)} points over ${p.runsA} and ${p.runsB} runs`).join('; ')}.` : 'No A/A repeat in this cell.';
    blocks.push(D.p(aaText));
    const tested = c.arms.filter((a) => !a.aaRepeatOf);
    blocks.push(D.table(
      ['arm', 'cost per run (arm vs vanilla)', 'cost ratio per run', 'cost ratio per successful run [95% CI]', 'quality (arm, vanilla)', 'difference', 'vanilla spread of one run', 'runs (arm / vanilla)', 'thresholds met'],
      tested.map((a) => [
        a.label, `${f(a.cost.perRunMean, 2)} vs ${f(a.cost.basePerRunMean, 2)}`, x(a.cost.ratioPerRun),
        `${x(a.cost.ratioPerSuccess)}${fin(a.cost.ciLow) && fin(a.cost.ciHigh) ? ` [${a.cost.ciLow.toFixed(2)}, ${a.cost.ciHigh.toFixed(2)}]` : ''}`,
        `${f(a.quality.value)}, ${f(a.quality.baseValue)}`, signed(a.quality.delta), f(a.quality.baseSd), `${a.quality.n} / ${a.quality.baseN}`, a.rawPass === null ? 'n/a' : a.rawPass ? 'yes' : 'no',
      ]),
    ));
    if (c.ratioComparison) {
      blocks.push(D.h(3, `${c.model} against the Claude cell`));
      if (c.ratioComparison.length) {
        blocks.push(D.table(
          ['arm', `${c.model}: ratio to vanilla (per run, per successful run)`, 'Claude cell: ratio to vanilla (per run, per successful run)', 'GPT ratio over Claude ratio (per run, per successful run)'],
          c.ratioComparison.map((r) => [r.armId, `${x(r.gpt.perRun)}, ${x(r.gpt.perSuccess)}`, `${x(r.claude.perRun)}, ${x(r.claude.perSuccess)}`, `${fin(r.relativePerRun) ? r.relativePerRun.toFixed(2) : 'n/a'}, ${fin(r.relativePerSuccess) ? r.relativePerSuccess.toFixed(2) : 'n/a'}`]),
        ));
        blocks.push(D.note(`The Claude reference is ${c.ratioComparison[0].reference}. Raw credits are not compared: the two models meter differently.`));
      } else blocks.push(D.p('No Claude cell on the same harness, so there is nothing to compare with.'));
    }
    blocks.push(D.h(3, 'Orchestration'));
    blocks.push(D.table(
      ['arm', 'runs with data', 'spawns (mean)', 'max spawn depth', 'review rounds (mean)', 'reworks after a pass (mean)', ...(v.phases ? ['phase documents present', 'every document present'] : [])],
      c.arms.map((a) => [a.label, a.orch?.withData ?? 0, f(a.orch?.spawns), fin(a.orch?.maxDepth) ? a.orch.maxDepth : 'n/a', f(a.orch?.reviewRounds), f(a.orch?.reworksAfterPass), ...(v.phases ? [pct(a.orch?.phaseDocsPresent), pct(a.orch?.phaseDocsComplete)] : [])]),
    ));
    const withTarget = tested.filter((a) => a.target);
    if (withTarget.length) {
      blocks.push(D.h(3, 'Changed skills: did they load?'));
      blocks.push(D.table(
        ['arm', 'changed skills', 'only skills changed', 'runs that loaded each (of runs with load data)', 'never loaded'],
        withTarget.map((a) => [a.label, a.target.names.join(', '), a.target.onlySkills ? 'yes' : 'no', `${Object.entries(a.target.loaded).map(([k, n]) => `${k} ${n}`).join(', ')} (of ${a.target.runsWithLoadData})`, a.target.neverLoaded.join(', ') || 'none']),
      ));
    }
    blocks.push(D.h(3, 'Failed runs'));
    blocks.push(D.table(
      ['arm', 'clean passes', 'checks failed', 'timeout', 'error', 'infra error', 'model mismatch', 'counted as quality 0'],
      tested.map((a) => [a.label, a.failures.good, a.failures.checksFailed, a.failures.timeout, a.failures.error, a.failures.infraError, a.failures.modelMismatch, a.failedAsZero]),
    ));
  }

  blocks.push(D.h(2, 'Definitions'));
  blocks.push(D.list([v.rule.cost, v.rule.quality, v.rule.drift, v.rule.evidence, v.rule.gpt, 'A failed or timed-out run counts as quality 0 when it has nothing to score, and its cost counts. No run is dropped.']));
  blocks.push(D.note(`${NEE} is not a finding that the arm is fine or not fine. It means this study cannot say. The thresholds are stated in full above so the same numbers can be re-read against a different rule.`));
  return { blocks, charts: new Map(), title: 'Orchestrator pass rule' };
}

module.exports = { buildOrchestratorPassDocument };
