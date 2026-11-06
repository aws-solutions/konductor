// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assembles the blocks of a run report at one detail level. quick: scorecard, three flags, headline table, cost vs
// quality scatter, per-task dot plot. full: everything, ending with the existing text tables unchanged.

const C = require('./charts.js');
const D = require('./doc.js');
const { ruleBlocks, sensitivitySection } = require('./quotedoc.js');
const { medianCI, diffCI, wilson } = require('./stats.js');
const { qualityOfRun, FORMULAS, checksModeNote, formulasForWeights } = require('./scores.js');
const { agreementOf, THRESHOLDS } = require('./diligence.js');
const { renderMarkdown } = require('./render.js');
const { CLASS_ORDER } = require('./aggregate.js');
const { MIN_RECALL } = require('../runner/lib/contamination.js');
const { gradedSummary, gradedTable } = require('./graded.js');
const { readLedger } = require('../runner/lib/credit-ledger.js');
const { orchBlocks } = require('./orch.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const f = (v, d = 1) => (fin(v) ? v.toFixed(d) : 'n/a');
const withCI = (o, d = 1) => (fin(o.value) ? `${f(o.value, d)} [${f(o.ciLow, d)}, ${f(o.ciHigh, d)}]` : 'n/a');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const classRank = (c) => (CLASS_ORDER.indexOf(c) + 1 || 99);
const MIN_REL = 0.15;

function scorecardBlocks(card, { compact }) {
  const shown = compact ? card.criteria.filter((c) => c.key && c.status !== 'N/A') : card.criteria;
  const out = [
    D.p(`**Overall rating: ${card.rating}.** ${card.counts.PASS} PASS, ${card.counts.WARN} WARN, ${card.counts.FAIL} FAIL, ${card.counts['N/A']} N/A.${card.blockers.length ? ` Key criteria not at PASS: ${card.blockers.map((b) => `${b.label} (${b.status})`).join('; ')}.` : ''}`),
    D.table(['criterion', 'status', 'measured', 'threshold'], shown.map((c) => [`${c.label}${c.key ? ' (key)' : ''}`, c.status, c.value, c.threshold])),
  ];
  if (compact) out.push(D.note(`Quick view: key criteria only. The full scorecard has ${card.criteria.length} rows (\`--detail full\`).`));
  return out;
}

/** The three most important non-PASS criteria: key FAIL, FAIL, key WARN, WARN, in that order. */
function topFlags(card) {
  const rank = (c) => (c.status === 'FAIL' ? (c.key ? 0 : 1) : c.key ? 2 : 3);
  return card.criteria.filter((c) => c.status === 'FAIL' || c.status === 'WARN').map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).slice(0, 3).map(({ c }) => `${c.status}: ${c.label}. ${c.value}`);
}

function headlineTable(scores, arms, costUnit) {
  const hasAut = arms.some((a) => scores.arms[a].overall?.autonomy);
  const head = ['arm', 'Quality /100 [95% CI]', 'n', 'Reliability /100', ...(hasAut ? ['Autonomy /100'] : []), `Cost ratio vs ${scores.baseline} (${costUnit} per successful run)`];
  const rows = arms.map((a) => {
    const c = scores.arms[a].overall;
    if (!c) return [a, 'n/a', '0', 'n/a', ...(hasAut ? ['n/a'] : []), 'n/a'];
    const e = c.efficiency.creditsPerSuccess;
    const q = c.quality;
    return [
      a === scores.baseline ? `${a} (base)` : a, `${withCI(q)}${q.anecdotal ? ' (anecdotal)' : ''}${q.ceiling ? ' (ceiling)' : ''}`, String(q.n),
      `${withCI(c.reliability, 0)}${c.reliability.anecdotal ? ' (anecdotal)' : ''}`,
      ...(hasAut ? [c.autonomy ? `${withCI(c.autonomy, 0)}${c.autonomy.anecdotal ? ' (anecdotal)' : ''}` : 'n/a'] : []),
      e.ratio === null ? `n/a (${e.value === null ? 'no clean pass' : 'base has none'})` : `${f(e.ratio, 2)}x [${f(e.ciLow, 2)}, ${f(e.ciHigh, 2)}] (${f(e.value, 2)} vs ${f(e.baseValue, 2)})${e.n < 3 ? ' (anecdotal)' : ''}`,
    ];
  });
  return D.table(head, rows);
}

function scoreRowsTable(scores) {
  return D.table(['arm', 'scope', 'score', 'value [95% CI]', 'n', 'inputs'], scores.rows.map((r) => [
    r.arm, r.scope, r.name, fin(r.value) ? `${f(r.value, r.unit === 'x' ? 2 : r.unit === '/100' ? 1 : 3)}${r.unit === '/100' ? '' : r.unit === 'x' ? 'x' : ''}${fin(r.ciLow) ? ` [${f(r.ciLow, r.unit === 'x' ? 2 : 1)}, ${f(r.ciHigh, r.unit === 'x' ? 2 : 1)}]` : ''}${r.anecdotal ? ' anecdotal' : ''}` : `n/a${r.anecdotal ? ' anecdotal' : ''}`, r.n, r.inputs || '',
  ]));
}

function tone(delta, lo, hi, band, higherBetter) {
  if (!fin(delta) || !(Math.abs(delta) > band)) return 'neutral';
  const excludesZero = !(fin(lo) && fin(hi)) || lo > 0 || hi < 0;
  if (!excludesZero) return 'neutral';
  return (delta > 0) === higherBetter ? 'good' : 'bad';
}

function forestRows(rows, base, heads, valueOf, { scale = 1, rel = false, higherBetter, groupOf = (r) => r.task }) {
  const out = [];
  const groups = [...new Set(rows.map(groupOf))].sort();
  for (const h of heads) {
    for (const t of groups) {
      const hv = rows.filter((r) => r.arm === h && groupOf(r) === t).map(valueOf).filter(fin);
      const bv = rows.filter((r) => r.arm === base && groupOf(r) === t).map(valueOf).filter(fin);
      const d = diffCI(hv, bv);
      if (d.delta === null) continue;
      const denom = rel ? mean(bv) : 1;
      if (rel && !denom) continue;
      const k = (v) => (v / denom) * scale;
      out.push({ label: `${h}: ${t}`, delta: k(d.delta), lo: k(d.ciLow), hi: k(d.ciHigh), n: Math.min(hv.length, bv.length), higherBetter });
    }
  }
  return out;
}

function noiseBands(aa, baseQuality) {
  const qBase = fin(baseQuality) ? baseQuality : 0;
  const qBand = aa && fin(aa.qualitySpread) ? { v: aa.qualitySpread, label: `A/A spread +/-${f(aa.qualitySpread)} pts` } : { v: MIN_REL * qBase, label: `no A/A: +/-${f(MIN_REL * qBase)} pts (15% of base)` };
  const cBand = aa && fin(aa.costSpread) ? { v: aa.costSpread * 100, label: `A/A spread +/-${f(aa.costSpread * 100, 0)}%` } : { v: MIN_REL * 100, label: 'no A/A: +/-15% (min-rel rule)' };
  return { qBand, cBand };
}

function agreementMatrix(records, judges, taskIds) {
  const pairs = [];
  for (let i = 0; i < judges.length; i++) for (let j = i + 1; j < judges.length; j++) pairs.push([judges[i], judges[j]]);
  const values = pairs.map(([a, b]) => taskIds.map((t) => {
    const ag = agreementOf(records.filter((r) => r.taskId === t && (r.judge === a || r.judge === b)));
    return ag ? ag.exact : null;
  }));
  return { rows: pairs.map(([a, b]) => `${a} ~ ${b}`), cols: taskIds, values };
}

function skillLoads(run) {
  const per = new Map();
  const armRuns = new Map();
  for (const e of run.runs) {
    const loaded = e.result.skillsLoaded;
    if (loaded == null || e.result.status === 'budget_skipped') continue;
    armRuns.set(e.armId, (armRuns.get(e.armId) || 0) + 1);
    for (const s of loaded) {
      const k = `${e.armId}\u0000${s.name}`;
      const cur = per.get(k) || { arm: e.armId, name: s.name, runs: 0, loads: 0 };
      cur.runs++; cur.loads += s.count || 1;
      per.set(k, cur);
    }
  }
  return [...per.values()].filter((s) => !/(^|-)vanilla$/.test(s.arm)).map((s) => ({ ...s, exposure: armRuns.get(s.arm) })).sort((a, b) => b.runs / b.exposure - a.runs / a.exposure || (a.name < b.name ? -1 : 1));
}

function commandsFor(run, report, detail) {
  const c = run.config;
  const dirs = run.dirs || [run.dir];
  const runFlags = [c.suite ? `--suite ${c.suite}` : null, c.armIds?.length ? `--arms ${c.armIds.join(',')}` : null, c.replicates ? `--replicates ${c.replicates}` : null, c.model ? `--model ${c.model}` : null, c.effort ? `--effort ${c.effort}` : null, c.seed !== undefined ? `--seed ${c.seed}` : null, c.budgetCredits ? `--budget-credits ${c.budgetCredits}` : null].filter(Boolean);
  return [
    `node bench/runner/bench.js run ${runFlags.join(' ')} --out DIR`,
    ...(report.judges.length ? [`node bench/runner/bench.js judge --run DIR --baseline ${report.baseline}`] : []),
    `node bench/runner/bench.js report --run ${dirs.join(',')} --baseline ${report.baseline} --detail ${detail} --format both`,
  ];
}

/**
 * args: run, tasks, report, rows, scores, card, facts, ctx, weights, detail ('quick'|'full').
 * Returns { blocks, charts: Map(name -> svg), title }.
 */
/** The profile banner and the list of what the run still lacks against it. */
function profileBlocks(profile, check) {
  const lead = profile.name === 'quick'
    ? `Profile quick: ${profile.replicates.min} to ${profile.replicates.max} replicates, no A/A arm, no controls. A result under ${profile.anecdotalBelow} runs is anecdotal and cannot support a keep or discard call. Use --profile detailed for that.`
    : `Profile detailed: at least ${profile.replicates.min} replicates per cell, an A/A arm, graded and pairwise judging in both answer orders, and a human calibration sample (calibration-sample.md in the results directory).`;
  return [
    D.note(lead),
    D.h(2, 'Profile check'),
    D.list(check.items.map((i) => `${i.ok ? 'met' : 'NOT MET'}: ${i.text}`)),
  ];
}

function buildRunDocument({ run, tasks, report, rows, scores, card, facts, ctx, weights, detail, profile = null, docPhases = null, quote = null, sens = null }) {
  const blocks = [];
  const charts = new Map();
  const full = detail === 'full';
  const add = (name, svg, alt) => { charts.set(name, svg); blocks.push(D.chart(name, svg, alt)); };
  const arms = Object.keys(scores.arms);
  const base = scores.baseline;
  const heads = arms.filter((a) => a !== base);
  const unit = report.costUnit === 'usd' ? 'USD' : 'credits';
  const good = rows.filter((r) => r.outcome === 'good');
  const rq = (r) => (r.outcome === 'infraError' || r.outcome === 'modelMismatch' ? null : qualityOfRun(r, weights)?.score ?? null);
  const taskOrder = [...new Set(rows.map((r) => r.task))].sort((a, b) => classRank(tasks.get(a)?.class) - classRank(tasks.get(b)?.class) || (a < b ? -1 : 1));
  const omitted = [];

  blocks.push(D.h(1, `Benchmark report (${detail})`));
  const r = report.run;
  blocks.push(D.p(`Run: ${(run.dirs || [run.dir]).length > 2 ? `${(run.dirs || []).length} run directories merged (listed in the full appendix)` : (run.dirs || [run.dir]).join(', ')}  \nSuite: ${r.suite ?? 'n/a'}, model ${r.model}, effort ${r.effort}, ${r.taskIds.length} task(s), ${arms.length} arm(s), ${rows.length} executed run(s)${facts.budget.skipped ? `, ${facts.budget.skipped} budget-skipped` : ''}  \nBaseline: ${base}. Judges: ${report.judges.join(', ') || 'none'}. Detail: ${detail}${full ? '' : ' (add --detail full for every chart, table and the appendix)'}.`));

  blocks.push(...ruleBlocks(quote, sens, { tables: full ? 'full' : 'none' }));

  if (profile) blocks.push(...profileBlocks(profile.profile, profile.check));

  blocks.push(D.h(2, 'Diligence scorecard'));
  blocks.push(...scorecardBlocks(card, { compact: !full }));
  const flags = topFlags(card);
  blocks.push(D.h(2, full ? 'Most important flags' : 'Top 3 flags'));
  blocks.push(flags.length ? D.list(flags) : D.p('None. Every applicable criterion passed.'));

  blocks.push(D.h(2, 'Scores'));
  blocks.push(headlineTable(scores, arms, unit));
  blocks.push(D.note('Quality is the weighted mean of the components a run has (hidden tests, checks, rubric), renormalised; reliability is 100 minus the share of timed-out, errored, infra-error and model-mismatch runs; the cost ratio is the arm over the base. Below 3 runs a score is anecdotal. Formulas: `bench/README.md`.'));

  // Cost vs quality
  const pts = arms.map((a) => {
    const g = good.filter((x) => x.arm === a).map((x) => x.credits).filter(fin);
    const m = g.length ? medianCI(g) : null;
    const q = scores.arms[a].overall?.quality;
    return { label: a, x: m?.median, xLo: m?.ciLow, xHi: m?.ciHigh, y: q?.value, yLo: q?.ciLow, yHi: q?.ciHigh, n: q?.n, isBase: a === base };
  });
  add('cost-vs-quality', C.scatter({ title: 'Cost vs quality, by arm', id: 'cost-vs-quality', subtitle: 'x: median cost of clean passes with 95% CI. y: quality score with 95% CI.', xLabel: `${unit} per run (median, clean passes)`, yLabel: 'quality (0-100)', yBounds: [0, 100], xBounds: [0, Infinity], points: pts }), 'Cost versus quality scatter with 95% whiskers per arm');

  const qDots = taskOrder.map((t) => ({ label: t, groups: arms.map((a) => ({ name: a, values: rows.filter((x) => x.arm === a && x.task === t).map(rq).filter(fin) })) }));
  add('dots-quality', C.dotPlot({ title: 'Quality per task, one dot per replicate', id: 'dots-quality', unit: 'quality (0-100)', min: 0, max: 100, rows: qDots }), 'Per-task dot plot of quality');

  if (!full) return { blocks, charts, title: 'Benchmark report (quick)' };

  // ---- full ----
  blocks.push(...sensitivitySection(sens));
  blocks.push(D.h(2, 'Scores with components'));
  blocks.push(scoreRowsTable(scores));
  blocks.push(D.list(Object.entries(formulasForWeights(FORMULAS, scores.weights)).filter(([k]) => k !== 'capability').map(([k, v]) => `**${k}**: ${v}`)));
  blocks.push(D.p(`Weights in use: hidden ${scores.weights.hidden}, checks ${scores.weights.checks}${checksModeNote(scores.weights)}, rubric ${scores.weights.rubric}${scores.weights.pack > 0 ? `, quality pack ${scores.weights.pack}` : ''}.`));

  blocks.push(D.h(2, 'Cost and effort by arm'));
  const metrics = [
    ['credits', `${unit} per run, clean passes`, (x) => x.credits, unit], ['wall', 'Wall clock per run, clean passes', (x) => (fin(x.wall) ? x.wall / 1000 : null), 'seconds'],
    ['model-calls', 'Model calls per run, clean passes', (x) => x.modelCalls, 'calls'], ['work-tool-calls', 'Work tool calls per run, clean passes', (x) => x.workToolCalls, 'calls'], ['subagent-calls', 'Subagent calls per run, clean passes', (x) => x.subagentCalls, 'calls'],
  ];
  for (const [name, title, get, u] of metrics) {
    const series = arms.map((a) => ({ name: a, values: scores.scopes.map((sc) => { const v = good.filter((x) => x.arm === a && (sc === 'overall' || x.cls === sc)).map(get).filter(fin); if (!v.length) return null; const m = medianCI(v); return { v: m.median, lo: m.ciLow, hi: m.ciHigh }; }) }));
    add(`bars-${name}`, C.groupedBarsCI({ title, id: `bars-${name}`, unit: u, categories: scores.scopes, series, subtitle: 'Median with 95% bootstrap CI of the median; clean passes only.' }), `${title}, overall and per task class`);
  }

  blocks.push(D.h(2, 'Per task'));
  const taskRows = [];
  for (const t of taskOrder) {
    for (const a of arms) {
      const mine = rows.filter((x) => x.arm === a && x.task === t);
      if (!mine.length) continue;
      const q = mine.map(rq).filter(fin);
      taskRows.push([t, a, mine.length, q.length ? f(mean(q)) : 'n/a', `${mine.filter((x) => x.outcome === 'good').length}/${mine.length}`, f(mean(mine.map((x) => x.credits).filter(fin)), 2), f(mean(mine.map((x) => x.wall).filter(fin)) / 1000, 0)]);
    }
  }
  blocks.push(D.table(['task', 'arm', 'n', 'quality /100 (mean)', 'clean passes', `${unit} per run (mean)`, 'wall s per run (mean)'], taskRows));
  const cDots = taskOrder.map((t) => ({ label: t, groups: arms.map((a) => ({ name: a, values: rows.filter((x) => x.arm === a && x.task === t).map((x) => x.credits).filter(fin) })) }));
  add('dots-cost', C.dotPlot({ title: `Cost per task (${unit}), one dot per replicate`, id: 'dots-cost', unit, rows: cDots }), 'Per-task dot plot of cost');

  if (heads.length) {
    blocks.push(D.h(2, `Deltas versus ${base}`));
    const { qBand, cBand } = noiseBands(facts.aa, scores.arms[base].overall?.quality.value);
    const qRows = forestRows(rows, base, heads, rq, { higherBetter: true }).map((x) => ({ ...x, tone: tone(x.delta, x.lo, x.hi, qBand.v, true) }));
    add('forest-quality', C.forestPlot({ title: `Quality delta versus ${base}, per task`, id: 'forest-quality', unit: 'quality points (head minus base)', rows: qRows, noise: { lo: -qBand.v, hi: qBand.v, label: qBand.label } }), 'Forest plot of per-task quality deltas with noise band');
    const cRows = forestRows(rows, base, heads, (x) => x.credits, { rel: true, scale: 100, higherBetter: false }).map((x) => ({ ...x, tone: tone(x.delta, x.lo, x.hi, cBand.v, false) }));
    add('forest-cost', C.forestPlot({ title: `Cost change versus ${base}, per task`, id: 'forest-cost', unit: '% change in cost per run (head vs base)', rows: cRows, noise: { lo: -cBand.v, hi: cBand.v, label: cBand.label } }), 'Forest plot of per-task cost change with noise band');
  } else omitted.push('Delta forest plots need two or more arms.');

  blocks.push(D.h(2, 'Judges'));
  const j = run.judgments;
  if (!j) {
    omitted.push('Judge charts (agreement heatmap, pairwise bars) need a judge run: this run has no judgments.json.');
    blocks.push(D.p('Not judged. The rubric component of quality is missing and is not imputed.'));
  } else {
    const recs = j.rubric.filter((x) => !ctx.isStale(x));
    const ag = facts.judging.agreement;
    blocks.push(D.p(`Judges: ${j.judges.join(', ')} (${facts.judging.families.join(', ')}); backend: ${(facts.judging.backends ?? []).length > 1 ? `mixed (${facts.judging.backends.join(', ')}), not comparable` : (facts.judging.backends ?? ['kiro'])[0]}. Agreement over criterion pairs of the same run: ${ag ? `exact ${f(ag.exact * 100, 0)}%, within one level ${f(ag.withinOne * 100, 0)}% (n=${ag.pairs}; bars: exact >= ${THRESHOLDS.exactMin * 100}%, within-one >= ${THRESHOLDS.withinOneMin * 100}%)` : 'not computable (one judge or no overlap)'}. Unjudged runs: ${facts.judging.unjudged.length}${facts.judging.unjudged.length ? ` (${facts.judging.unjudged.slice(0, 10).join(', ')})` : ''}.`));
    const m = agreementMatrix(recs, j.judges, taskOrder);
    add('judge-agreement', C.heatmap({ title: 'Judge agreement: exact verdict match per judge pair and task', id: 'judge-agreement', rows: m.rows, cols: m.cols, values: m.values, min: 0, max: 1 }), 'Heatmap of exact criterion agreement by judge pair and task');
    const pw = heads.map((a) => ({ a, t: report.arms[a]?.overall?.pairwise?.total })).filter((x) => x.t);
    if (pw.length) {
      add('pairwise', C.stackedBars({ title: `Pairwise verdicts versus ${base} (win, tie, loss)`, id: 'pairwise', normalize: true, segments: [{ key: 'win', name: 'win', color: '#009E73' }, { key: 'tie', name: 'tie', color: '#7A7A7A' }, { key: 'loss', name: 'loss', color: '#D55E00' }], rows: pw.map(({ a, t }) => ({ label: a, values: { win: t.win, tie: t.tie, loss: t.loss }, note: `position-inconsistent ${t.positionInconsistent} of ${t.win + t.tie + t.loss + t.errors}` })) }), 'Stacked pairwise win, tie and loss per arm');
    } else omitted.push('Pairwise bars need pairwise judgments (judge --mode pairwise).');
    const graded = gradedSummary(j, { isStale: ctx.isStale });
    if (graded.present) {
      const gt = gradedTable(graded);
      blocks.push(D.h(3, 'Graded judging (1 to 5)'));
      blocks.push(D.table(gt.head, gt.rows));
      blocks.push(D.note(gt.note));
    }
  }

  const aut = arms.map((a) => ({ a, rs: rows.filter((x) => x.arm === a && x.turns > 0) })).filter((x) => x.rs.length);
  if (aut.length) {
    blocks.push(D.h(2, 'Autonomy'));
    add('autonomy', C.stackedBars({
      title: 'Autonomy-tier runs: how much help was needed', id: 'autonomy', normalize: true,
      segments: [{ key: 'done', name: 'completed without help', color: '#009E73' }, { key: 'asked', name: 'asked or needed a reply', color: '#E69F00' }, { key: 'other', name: 'no help, not completed', color: '#D55E00' }],
      rows: aut.map(({ a, rs }) => { const asked = rs.filter((x) => x.interjections > 0 || x.questionsAsked > 0).length; const done = rs.filter((x) => x.completedWithoutHelp === true && !(x.interjections > 0 || x.questionsAsked > 0)).length; return { label: a, values: { done, asked, other: rs.length - asked - done }, note: `${f(mean(rs.map((x) => x.interjections)), 2)} interjections per task` }; }),
    }), 'Stacked bars of autonomy outcomes per arm');
  }

  const sk = skillLoads(run);
  if (sk.length) {
    blocks.push(D.h(2, 'Skills loaded'));
    add('skills-load', C.hBars({ title: 'Skill load rate by arm (runs that loaded the skill / runs recorded)', id: 'skills-load', percent: true, max: 1, rows: sk.slice(0, 16).map((s) => { const w = wilson(s.runs, s.exposure); return { label: `${s.arm}: ${s.name}`, value: s.runs / s.exposure, lo: w?.lo, hi: w?.hi, note: `n=${s.exposure}` }; }) }), 'Skill load rate bars with Wilson intervals');
    blocks.push(D.p('Exposure here is every recorded run of the arm. For one decision per skill, with exposure that respects what each agent can reach, use `cap prune-report`.'));
  }

  const cont = rows.filter((x) => x.contamination);
  if (cont.length) {
    blocks.push(D.h(2, 'Contamination'));
    blocks.push(D.table(['arm', 'audited', 'externalFetch', 'fixRecall'], arms.map((a) => { const c = cont.filter((x) => x.arm === a); return [a, c.length, c.filter((x) => (x.contamination.externalFetch || []).length).length, c.filter((x) => (x.contamination.fixRecallChars || 0) >= MIN_RECALL).length]; })));
  }

  blocks.push(...orchBlocks(run, { phases: docPhases }));

  blocks.push(D.h(2, 'Spend'));
  const spendRows = arms.map((a) => { const rs = rows.filter((x) => x.arm === a); return [a, rs.length, f(rs.reduce((n, x) => n + (fin(x.credits) ? x.credits : 0), 0), 2), f(mean(rs.map((x) => x.credits).filter(fin)), 2), rs.filter((x) => x.censored).length]; });
  blocks.push(D.table(['arm', 'runs', `${unit} charged`, `${unit} per run`, 'censored runs'], spendRows));
  const runTotal = rows.reduce((n, x) => n + (fin(x.credits) ? x.credits : 0), 0);
  const phases = { run: runTotal, judge: fin(j?.spentCredits) ? j.spentCredits : 0, ...(run.spend || {}) };
  add('spend', C.stackedBars({ title: `Spend by phase (${unit})`, id: 'spend', unit, segments: [{ key: 'run', name: 'run' }, { key: 'judge', name: 'judge' }, { key: 'draft', name: 'draft' }, { key: 'trigger', name: 'trigger' }].filter((s) => phases[s.key] > 0), rows: [{ label: 'all phases', values: phases, note: `total ${f(Object.values(phases).reduce((n, v) => n + (fin(v) ? v : 0), 0), 2)}` }] }), 'Stacked bar of spend by phase');
  const ledgers = (run.dirs || [run.dir]).map((d) => readLedger(d));
  const found = ledgers.filter((l) => l.exists);
  if (found.length) {
    const t = found.reduce((a, l) => ({ run: a.run + l.totals.run, judge: a.judge + l.totals.judge, other: a.other + l.totals.other, total: a.total + l.totals.total, calls: a.calls + l.totals.calls }), { run: 0, judge: 0, other: 0, total: 0, calls: 0 });
    blocks.push(D.p(`Credit ledger (credit-ledger.jsonl): ${f(t.total, 2)} ${unit} in ${t.calls} call(s): runs ${f(t.run, 2)}, judge ${f(t.judge, 2)}${t.other ? `, other ${f(t.other, 2)}` : ''}.`));
  } else blocks.push(D.p('No credit ledger in this run directory (it predates the ledger); the totals above come from the result files.'));
  if (phases.draft === undefined && phases.trigger === undefined) blocks.push(D.p('Draft and trigger spend are not part of a run directory; they appear here when a spend.json (draft, trigger) sits beside the results.'));

  const timeline = rows.filter((x) => fin(x.wall)).sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0)).map((x) => ({ label: `${x.arm}/${x.task}#${x.rep}`, arm: x.arm, ms: x.wall, status: x.status }));
  add('durations', C.durationBars({ title: 'Run durations in start order (T = timeout, E = error)', id: 'durations', runs: timeline }), 'Bars of run durations with timeouts marked');

  if (omitted.length) { blocks.push(D.h(2, 'Not shown')); blocks.push(D.list(omitted)); }

  blocks.push(D.h(2, 'Appendix: provenance and how to reproduce'));
  const cfgs = (run.configs || [{ dir: run.dir, config: run.config }]);
  blocks.push(D.table(['run directory', 'bench commit', 'bench tree', 'content hash', 'tools', 'isolation', 'started'], cfgs.map(({ dir, config }) => [dir, (config.benchCommit || 'not recorded').slice(0, 12), config.benchDirty === true ? 'dirty' : config.benchDirty === false ? 'clean' : 'not recorded', (config.contentHash || 'not recorded').slice(0, 12), config.tools ? Object.entries(config.tools).map(([k, v]) => `${k} ${String(v).replace(/^\S+ /, '')}`).join('; ') : 'not recorded', config.isolation?.mode || 'not recorded', config.startedAt || 'not recorded'])));
  blocks.push(D.table(['arm', 'ref', 'commit or content hash', 'tree'], (run.config.arms || []).map((a) => [a.id, a.ref || 'n/a', (a.commitSha || a.contentHash || 'not recorded').slice(0, 12), a.dirty === true ? 'dirty' : a.dirty === false ? 'clean' : 'n/a'])));
  blocks.push(D.p('Commands to reproduce (DIR is a new output directory):'));
  blocks.push(D.list(commandsFor(run, report, 'full').map((c) => `\`${c}\``)));

  blocks.push(D.h(2, 'Detailed tables (the existing report, unchanged)'));
  blocks.push(D.md(D.demote(renderMarkdown(report).replace(/^# Benchmark report\n+/, ''), 1)));
  return { blocks, charts, title: 'Benchmark report (full)' };
}

module.exports = { buildRunDocument, scorecardBlocks, topFlags, forestRows, tone, agreementMatrix, skillLoads, headlineTable, noiseBands, MIN_REL };
