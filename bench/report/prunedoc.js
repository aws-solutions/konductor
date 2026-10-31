// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap prune-report at a detail level: a scorecard for the report itself, class and load-rate charts, a decision table
// with one row per skill and harness, and (full) one decision card per skill that has a signal, then the existing text.

const C = require('./charts.js');
const D = require('./doc.js');
const { buildSkillCards, MIN_EVIDENCE_N } = require('./skillcard.js');
const { rate } = require('./diligence.js');
const { renderPrune, OWN_THRESHOLDS_NOTE, LOAD_RATE_NOTE } = require('../cap/prune.js');
const { FORMULAS } = require('./scores.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (v) => (fin(v) ? `${Math.round(v * 100)}%` : 'n/a');
const f = (v, d = 2) => (fin(v) ? v.toFixed(d) : 'n/a');
const CLASS_KEYS = ['HARMS', 'RELOCATE', 'PRUNE', 'FIX', 'KEEP', 'KEEP (provisional)', 'NEEDS DATA'];
const gainText = (e) => {
  if (!fin(e.gain)) return e.atCeiling ? 'undefined (without is at ceiling)' : 'n/a';
  return `${f(e.gain)}${e.gainKind === 'change' ? ' (normalized change)' : ''}${e.atCeiling ? ' (without at ceiling, can overstate small differences)' : ''}`;
};
const labelOf = (c) => (c.cls === 'KEEP' && c.provisional ? 'KEEP (provisional)' : c.cls);
const crit = (id, label, key, status, value, threshold) => ({ id, label, key, status, value, threshold, note: '' });

/** Scorecard for the report itself: is there enough data behind the classes to act on them? */
function pruneScorecard(report, cards) {
  const primary = report.harnesses[0];
  const mine = cards.filter((c) => c.harness === primary);
  const share = (n, d) => (d ? n / d : 0);
  const out = [];
  const exp = share(mine.filter((c) => c.exposed >= report.minExposure).length, mine.length);
  out.push(crit('exposure', 'Skills offered in enough runs', true, exp >= 0.8 ? 'PASS' : exp >= 0.4 ? 'WARN' : 'FAIL', `${mine.filter((c) => c.exposed >= report.minExposure).length} of ${mine.length} skills have at least ${report.minExposure} exposed runs on ${primary}`, '>= 80% PASS, >= 40% WARN'));
  const decided = mine.filter((c) => ['HARMS', 'PRUNE', 'KEEP'].includes(c.cls));
  const backed = decided.filter((c) => c.evidence.length);
  out.push(decided.length
    ? crit('evidence', 'Decisions backed by a controlled result', true, backed.length === decided.length ? 'PASS' : backed.length ? 'WARN' : 'FAIL', `${backed.length} of ${decided.length} skills classed HARMS, PRUNE or KEEP have evidence rows (FIX is a prompt to check, not a verdict)`, 'all')
    : crit('evidence', 'Decisions backed by a controlled result', true, 'N/A', 'no skill has a decision class', 'all'));
  const rows = cards.flatMap((c) => c.evidence);
  out.push(rows.length
    ? crit('aa', 'Evidence rows record an A/A spread', true, rows.every((r) => fin(r.aaSpread)) ? 'PASS' : 'WARN', `${rows.filter((r) => fin(r.aaSpread)).length} of ${rows.length} rows`, 'all')
    : crit('aa', 'Evidence rows record an A/A spread', true, 'N/A', 'no evidence rows', 'all'));
  out.push(rows.length
    ? crit('sample', `Evidence rows cover at least ${MIN_EVIDENCE_N} runs`, false, rows.every((r) => r.n >= MIN_EVIDENCE_N) ? 'PASS' : 'WARN', `${rows.filter((r) => r.n >= MIN_EVIDENCE_N).length} of ${rows.length} rows`, `n >= ${MIN_EVIDENCE_N}`)
    : crit('sample', `Evidence rows cover at least ${MIN_EVIDENCE_N} runs`, false, 'N/A', 'no evidence rows', `n >= ${MIN_EVIDENCE_N}`));
  const coarse = share(report.usage.runs.coarse, report.usage.runs.counted);
  out.push(crit('coarse', 'Exposure is by named agent', false, coarse <= 0.1 ? 'PASS' : 'WARN', `${report.usage.runs.coarse} of ${report.usage.runs.counted} counted runs delegated to an unnamed agent`, '<= 10%'));
  const off = report.usage.refs.filter((r) => r.matchesBase === false);
  out.push(crit('base', 'Runs were built from the base commit', true, off.length ? 'WARN' : report.usage.refs.length ? 'PASS' : 'WARN', off.length ? `${off.length} ref row(s) differ from the base: ${off.map((r) => r.ref).join(', ')}` : report.usage.refs.length ? `${report.usage.refs.length} ref row(s), all at the base or variants` : 'no runs counted', 'all at the base'));
  const linked = share(mine.filter((c) => c.linkedTasks.length).length, mine.length);
  out.push(crit('tasks', 'Skills with a linked bench task', false, linked >= 0.8 ? 'PASS' : 'WARN', `${mine.filter((c) => c.linkedTasks.length).length} of ${mine.length}`, '>= 80%'));
  const nd = share(mine.filter((c) => c.cls === 'NEEDS DATA').length, mine.length);
  out.push(crit('needsdata', 'Skills the data can classify', false, nd <= 0.5 ? 'PASS' : 'WARN', `${pct(nd)} are NEEDS DATA`, '<= 50%'));
  out.push(crit('provenance', 'Base commit recorded', true, report.base.commitSha ? 'PASS' : 'WARN', report.base.commitSha ? report.base.commitSha.slice(0, 10) : 'not recorded (a directory base)', 'a commit'));
  return out;
}

const decisionRow = (c) => [
  c.id, c.harness, `${labelOf(c)} (${c.confidence})`, c.verdict, c.exposed, c.rate === null ? 'n/a' : `${c.runsLoaded} (${pct(c.rate)} [${pct(c.lo)}, ${pct(c.hi)}])`,
  `${c.bytes} B / ${c.estTokens} tok${c.trim.flag ? ' (TRIM)' : ''}`,
  c.evidence.length ? c.evidence.map((e) => `${e.verdict}${fin(e.delta) ? ` ${f(e.delta)}` : ''}${fin(e.aaSpread) ? ` vs ${f(e.aaSpread)}` : ''}${e.insideNoise ? ' (inside noise)' : ''}`).join('; ') : 'none',
];
const DECISION_HEAD = ['skill', 'harness', 'class (confidence)', 'decision-board verdict (our mapping)', 'exposed runs', 'runs loaded (rate [95% CI])', 'size', 'controlled evidence (delta vs A/A spread)'];

function cardBlocks(c) {
  const out = [D.h(3, `Decision card: ${c.id} on ${c.harness}`)];
  out.push(D.p(`**${labelOf(c)}** (confidence ${c.confidence}); decision-board verdict, our mapping: **${c.verdict}**. ${c.reason}`));
  out.push(D.table(['measure', 'value'], [
    ['Load rate (runs that loaded it / runs that could)', c.rate === null ? 'n/a (never offered)' : `${c.runsLoaded} of ${c.exposed} = ${pct(c.rate)}, 95% Wilson [${pct(c.lo)}, ${pct(c.hi)}]`],
    ['Cost when loaded', `${c.meanBytesPerLoad === null ? 'no load seen' : `${c.meanBytesPerLoad} bytes per load`}; file ${c.bytes} bytes (about ${c.estTokens} tokens)${c.trim.flag ? '; TRIM flagged' : ''}`],
    ['Linked bench tasks', c.linkedTasks.length ? c.linkedTasks.join(', ') : 'none'],
  ]));
  if (c.evidence.length) {
    out.push(D.table(['kind', 'task', 'n', 'verdict', 'delta (0 to 1)', 'A/A spread (0 to 1)', 'with / without', 'lift (points; with minus without, not paired, no interval)', 'normalized gain or change', 'flags'], c.evidence.map((e) => [
      e.kind, e.task, e.n, e.verdict, f(e.delta), f(e.aaSpread), `${fin(e.withValue) ? pct(e.withValue) : 'n/a'} / ${fin(e.withoutValue) ? pct(e.withoutValue) : 'n/a'}`, fin(e.liftPoints) ? f(e.liftPoints, 1) : 'n/a',
      gainText(e), [e.negative ? 'negative delta' : null, e.insideNoise ? 'inside A/A noise' : null, e.atCeiling ? 'without at ceiling (0.95 or more)' : null, e.unitMismatch ? 'units differ: delta is not with minus without' : null].filter(Boolean).join(', ') || '-',
    ])));
  }
  out.push(D.table(['before acting', 'answer', 'detail'], c.checks.map((x) => [x.label, x.status, x.detail])));
  out.push(D.p(`What would change this: ${c.wouldChange}`));
  return out;
}

/** report: a prune report object (buildPruneReport). detail: 'quick' | 'full'. */
function buildPruneDocument(report, { detail = 'full' } = {}) {
  const full = detail === 'full';
  const blocks = [];
  const charts = new Map();
  const add = (name, svg, alt) => { charts.set(name, svg); blocks.push(D.chart(name, svg, alt)); };
  const cards = buildSkillCards(report);
  const criteria = pruneScorecard(report, cards);
  const { rating, blockers } = rate(criteria);
  const counts = (s) => criteria.filter((c) => c.status === s).length;
  const primary = report.harnesses[0];

  blocks.push(D.h(1, `Prune report (${detail})`));
  blocks.push(D.p(`Base: ${report.base.label}${report.base.commitSha ? ` (${report.base.commitSha.slice(0, 10)})` : ''}; harness: ${report.harnesses.join(', ')}; minimum exposure ${report.minExposure} runs; ${report.usage.runs.counted} run(s) counted; ${report.summary.skills} skills. A class is a recommendation, never a deletion.`));
  blocks.push(D.h(2, 'Diligence scorecard'));
  blocks.push(D.p(`**Overall rating: ${rating}.** ${counts('PASS')} PASS, ${counts('WARN')} WARN, ${counts('FAIL')} FAIL, ${counts('N/A')} N/A.${blockers.length ? ` Key criteria not at PASS: ${blockers.map((b) => `${b.label} (${b.status})`).join('; ')}.` : ''}`));
  blocks.push(D.table(['criterion', 'status', 'measured', 'threshold'], criteria.map((c) => [`${c.label}${c.key ? ' (key)' : ''}`, c.status, c.value, c.threshold])));
  for (const w of report.warnings.slice(0, full ? 20 : 3)) blocks.push(D.note(w));

  blocks.push(D.h(2, 'Classes'));
  add('class-distribution', C.stackedBars({
    title: 'Skills by recommended class', id: 'class-distribution', segments: CLASS_KEYS.map((k) => ({ key: k, name: k, color: C.CLASS_COLORS[k] })),
    rows: report.harnesses.map((h) => ({ label: h, values: report.summary.byHarness[h], note: `${report.summary.skills} skills` })), unit: 'skills',
  }), 'Stacked bars of skill counts by recommended class');

  const seen = cards.filter((c) => c.harness === primary && c.exposed > 0).sort((a, b) => b.rate - a.rate || b.exposed - a.exposed || (a.id < b.id ? -1 : 1));
  add('load-rate', C.hBars({
    title: `Load rate by skill on ${primary} (runs that loaded it / runs that could)`, id: 'load-rate', percent: true, max: 1,
    rows: [...seen.filter((c) => c.runsLoaded > 0), ...seen.filter((c) => c.runsLoaded === 0).slice(0, full ? 8 : 4)].slice(0, full ? 30 : 12).map((c) => ({ label: c.id.replace(/^skill:/, ''), value: c.rate, lo: c.lo, hi: c.hi, note: `n=${c.exposed}`, color: C.CLASS_COLORS[labelOf(c)] })),
    subtitle: seen.length ? `${seen.length} skill(s) were offered at least once, ${seen.filter((c) => c.runsLoaded === 0).length} never loaded (the most-offered few are shown). Colour is the class; whiskers are 95% Wilson intervals.` : 'No skill was offered in the counted runs.',
  }), 'Horizontal bars of skill load rate with Wilson intervals');
  if (full) {
    add('bytes-vs-load', C.scatter({
      title: `Skill size against load rate on ${primary}`, id: 'bytes-vs-load', xLabel: 'skill file size (bytes)', yLabel: 'load rate', yBounds: [0, 1], xBounds: [0, Infinity], yFmt: pct,
      points: seen.map((c, i) => ({ label: c.id.replace(/^skill:/, ''), noLabel: !(c.runsLoaded > 0 && i < 8), x: c.bytes, y: c.rate, yLo: c.runsLoaded > 0 ? c.lo : undefined, yHi: c.runsLoaded > 0 ? c.hi : undefined, color: C.CLASS_COLORS[labelOf(c)] })),
      uniformShape: true, subtitle: 'Large and rarely loaded skills sit bottom right. Skills that loaded at least once are labelled (up to 8) and carry a 95% interval.',
    }), 'Scatter of skill size against load rate');
  }

  blocks.push(D.h(2, 'Per-skill decisions'));
  const signal = cards.filter((c) => c.cls !== 'NEEDS DATA' || c.evidence.length || c.exposed > 0 || c.trim.flag);
  const rows = (full ? cards : signal.filter((c) => c.harness === primary).slice(0, 15)).map(decisionRow);
  blocks.push(D.table(DECISION_HEAD, rows));
  if (!full) blocks.push(D.note(`Quick view: ${rows.length} of ${cards.length} skill and harness rows. The per-skill cards and the TRIM and evidence tables are in the full report (\`--detail full\`).`));
  blocks.push(D.note(`The decision-board verdict maps our classes to keep, prune candidate, needs human review and incomplete. It is our mapping: no gap threshold from another scale is copied, because this tool does not produce a 1 to 5 judge gap. A prune candidate needs medium or high confidence, a delta outside the A/A spread and consistent units, and a HARMS class also needs at least ${MIN_EVIDENCE_N} evidence runs; weaker cases read needs human review. A prune candidate always needs a person to approve it.`));
  blocks.push(D.note(LOAD_RATE_NOTE));
  blocks.push(D.note(OWN_THRESHOLDS_NOTE));

  if (!full) return { blocks, charts, title: 'Prune report (quick)' };

  const trims = report.capabilities.filter((c) => c.trim.flag);
  blocks.push(D.h(2, 'Skills to trim'));
  blocks.push(trims.length ? D.table(['skill', 'bytes', 'est. tokens', 'why', 'class'], trims.map((c) => [c.id, c.bytes, c.estTokens, c.trim.reasons.map((r) => (r.type === 'size' ? `over p90 (${r.p90} bytes)` : `near duplicate of ${r.neighbour} (${r.score})`)).join('; '), report.harnesses.map((h) => `${h}: ${labelOf({ cls: c.harnesses[h].classification.class, provisional: c.harnesses[h].classification.provisional })}`).join(', ')])) : D.p('None.'));

  blocks.push(D.h(2, 'Evidence rows'));
  const evRows = cards.filter((c) => c.evidence.length).flatMap((c) => c.evidence.map((e) => [c.id, c.harness, e.kind, e.task, e.n, e.verdict, f(e.delta), f(e.aaSpread), e.insideNoise === null ? 'unknown' : e.insideNoise ? 'yes' : 'no', gainText(e), e.runId || '-']));
  blocks.push(evRows.length ? D.table(['skill', 'harness', 'kind', 'task', 'n', 'verdict', 'delta', 'A/A spread', 'inside noise', 'normalized gain or change', 'run'], evRows) : D.p('No evidence rows were given (`--evidence FILE`). Every class here rests on reach, size and load counts alone.'));

  blocks.push(D.h(2, 'Decision cards'));
  const withSignal = cards.filter((c) => c.harness === primary && (c.cls !== 'NEEDS DATA' || c.evidence.length));
  if (!withSignal.length) blocks.push(D.p('No skill has a class other than NEEDS DATA and none has evidence, so there is no card to show. The table above lists every skill.'));
  for (const c of withSignal.slice(0, 40)) blocks.push(...cardBlocks(c));
  if (withSignal.length > 40) blocks.push(D.note(`${withSignal.length - 40} more card(s) are in prune-report.json.`));
  blocks.push(D.note(FORMULAS.capability));

  blocks.push(D.h(2, 'Detailed tables (the existing report, unchanged)'));
  blocks.push(D.md(D.demote(renderPrune(report).replace(/^# [^\n]*\n+/, ''), 1)));
  return { blocks, charts, title: 'Prune report (full)', cards, criteria, rating };
}

module.exports = { buildPruneDocument, pruneScorecard };
