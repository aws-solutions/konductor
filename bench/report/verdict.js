// SPDX-License-Identifier: Apache-2.0
'use strict';

// The platform verdict: for each arm against the baseline, the quality, reliability, autonomy, cost ratio and latency
// ratio the existing score code computes, the evidence behind them, and one plain call: KEEP, DISCARD or NOT ENOUGH
// EVIDENCE. The call is conservative on purpose. Fewer than 3 runs, fewer than 5 paired task cells, a difference inside the
// A/A noise or an anecdotal diligence rating can only give NOT ENOUGH EVIDENCE; so can a missing noise floor, fewer than 3
// replicates in a cell, a paired 95% interval that includes 0, more than a fifth of the runs on a side without a score, arms
// scored on different components, and a quality gain bought with clearly lower reliability or a cost over 2.0x. The interval is
// paired by cell (task and run directory): both arms ran the same tasks, so the unit of evidence is the task, not the run.
// Arms are labelled by exact ref.

const fs = require('node:fs');
const path = require('node:path');
const { loadRun, readJson } = require('./load.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { analyze } = require('./generate.js');
const { computeScores, qualityOfRun, loadScoring, MIN_N } = require('./scores.js');
const { diffCI, pairedCellCI, MIN_CELLS } = require('./stats.js');
const { THRESHOLDS } = require('./diligence.js');
const { gradedSummary } = require('./graded.js');
const { readLedger } = require('../runner/lib/credit-ledger.js');
const { profileCheck } = require('../runner/lib/profiles.js');

const KEEP = 'KEEP';
const DISCARD = 'DISCARD';
const NEE = 'NOT ENOUGH EVIDENCE';
const RATING_RANK = { anecdotal: 0, indicative: 1, supported: 2 };
// A difference smaller than the diligence A/A drift limit is never called real, even when the measured A/A spread is smaller.
const NOISE_FLOOR_PTS = THRESHOLDS.aaQualityPts;
const FAILURE_OUTCOMES = ['timeout', 'error', 'infraError', 'modelMismatch', 'checksFailed'];
// A side may have at most this share of its runs without a score (infra error, model mismatch, nothing to score) before the
// call is refused. One run in five is the most a quality mean can lose without the missing runs deciding the result.
const MAX_NONSCORED_SHARE = 0.2;
// A KEEP needs the arm to cost at most this multiple of the baseline per successful run, the same limit the orchestrator pass rule uses.
const COST_MAX = 2.0;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f1 = (v) => v.toFixed(1);

/** id@sha7 for a commit, id@dir:hash12 for a directory snapshot, the bare id for an arm with no ref (vanilla). */
function refLabel({ armId, commitSha, contentHash }) {
  if (commitSha) return `${armId}@${String(commitSha).slice(0, 7)}`;
  if (contentHash) return `${armId}@dir:${String(contentHash).slice(0, 12)}`;
  return armId;
}

/**
 * The call, from plain numbers. Every reason that applies is listed. quality and reliability carry the head-minus-base
 * difference in points with its 95% interval; noise.pts is the A/A noise in quality points (null when none was measured).
 */
function decide(c) {
  const reasons = [];
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (!c.cells) reasons.push('there is no run of the baseline on the same tasks');
  if (c.nHead < MIN_N || c.nBase < MIN_N) reasons.push(`fewer than ${MIN_N} runs on a side (${c.nHead} for the arm, ${c.nBase} for the baseline)`);
  if (c.cells && c.minReps < MIN_N) reasons.push(`fewer than ${MIN_N} replicates in a cell (the smallest has ${c.minReps})`);
  const k = c.pairedCells ?? 0;
  if (c.cells && k < MIN_CELLS) reasons.push(`fewer than ${MIN_CELLS} paired task cells (${k}), too few for an interval that holds its 95% level`);
  for (const [who, side] of [['the arm', c.nonScored?.head], ['vanilla', c.nonScored?.base]]) {
    if (side && side.total && side.n / side.total > MAX_NONSCORED_SHARE) reasons.push(`${side.n} of ${side.total} runs of ${who} have no score (infra errors, model mismatches or nothing to score), over the ${pct(MAX_NONSCORED_SHARE)} limit`);
  }
  if (c.components && c.components.ok === false) reasons.push(c.components.reason);
  if (c.rating === 'anecdotal') {
    const why = (c.ratingBy || []).filter((r) => r.rating === 'anecdotal').flatMap((r) => r.failed ?? r.blockers ?? []);
    reasons.push(`the diligence rating is anecdotal${why.length ? ` (${[...new Set(why)].join('; ')})` : ''}`);
  }
  if (!c.noise.available) reasons.push('there is no A/A noise floor, so a difference cannot be told from run-to-run noise');
  const q = c.quality;
  const insideNoise = c.noise.available && fin(q.delta) && Math.abs(q.delta) <= c.noise.pts;
  if (!fin(q.delta)) reasons.push('quality could not be computed for both sides');
  else if (insideNoise) reasons.push(`the quality difference of ${f1(q.delta)} points is inside the A/A noise of ${f1(c.noise.pts)} points`);
  else if (!fin(q.ciLow) || !fin(q.ciHigh)) reasons.push('the paired interval of the quality difference could not be computed');
  else if (c.noise.available && q.ciLow <= 0 && q.ciHigh >= 0) reasons.push(`the paired 95% interval of the quality difference [${f1(q.ciLow)}, ${f1(q.ciHigh)}] includes 0`);
  if (reasons.length) return { verdict: NEE, reason: reasons.join('; '), reasons };
  const r = c.reliability;
  if (q.delta > 0 && fin(r.delta) && fin(r.ciHigh) && r.ciHigh < 0) {
    const reason = `quality is up ${f1(q.delta)} points but reliability is clearly down ${f1(-r.delta)} points, a mixed result that needs a person to weigh`;
    return { verdict: NEE, reason, reasons: [reason] };
  }
  if (q.delta > 0) {
    const ratio = c.cost?.ratio;
    if (!fin(ratio) && ratio !== Infinity) {
      const reason = `quality is up ${f1(q.delta)} points but the cost ratio could not be computed, so the gain cannot be weighed against its price`;
      return { verdict: NEE, reason, reasons: [reason] };
    }
    if (ratio > COST_MAX) {
      const reason = `quality is up ${f1(q.delta)} points but it costs ${ratio === Infinity ? 'an unbounded multiple of' : `${ratio.toFixed(2)}x`} vanilla per successful run, over the ${COST_MAX.toFixed(1)}x limit, a mixed result that needs a person to weigh`;
      return { verdict: NEE, reason, reasons: [reason] };
    }
  }
  return q.delta > 0
    ? { verdict: KEEP, reason: `quality is up ${f1(q.delta)} points, outside the A/A noise of ${f1(c.noise.pts)} points, with the paired 95% interval above 0`, reasons: [] }
    : { verdict: DISCARD, reason: `quality is down ${f1(-q.delta)} points, outside the A/A noise of ${f1(c.noise.pts)} points, with the paired 95% interval below 0`, reasons: [] };
}

const lowest = (ratings) => ratings.reduce((a, b) => (RATING_RANK[b] < RATING_RANK[a] ? b : a), 'supported');

function readOptional(file) {
  try { return readJson(file); } catch { return null; }
}

// A failed run with nothing to score is a zero, not a gap: the verdict never drops one.
function normalize(r, src) {
  const noComponent = r.hidden === null && r.checks === null && r.rubric === null;
  const zeroFilled = noComponent && (r.outcome === 'timeout' || r.outcome === 'error');
  return { ...r, armId: r.arm, label: refLabel({ armId: r.arm, commitSha: r.commitSha, contentHash: r.contentHash }), src, zeroFilled, checks: zeroFilled ? 0 : r.checks };
}

const qualityList = (rows, weights) => rows
  .filter((r) => r.outcome !== 'infraError' && r.outcome !== 'modelMismatch')
  .map((r) => qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights)?.score)
  .filter(fin);

const cellKey = (r) => `${r.src}|${r.task}`;
const isNonScored = (r, weights) => {
  if (r.outcome === 'infraError' || r.outcome === 'modelMismatch') return true;
  return !qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights);
};

/** How many of a side's runs have no score, and why. */
function nonScoredOf(rows, weights) {
  const by = { infraError: 0, modelMismatch: 0, noComponent: 0 };
  for (const r of rows) {
    if (r.outcome === 'infraError') by.infraError++;
    else if (r.outcome === 'modelMismatch') by.modelMismatch++;
    else if (!qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights)) by.noComponent++;
  }
  const n = by.infraError + by.modelMismatch + by.noComponent;
  return { n, total: rows.length, share: rows.length ? n / rows.length : 0, ...by };
}

/**
 * The scored runs of both sides grouped by cell (run directory and task): [{ cell, task, head: number[], base: number[], headSigs, baseSigs }].
 * A signature is the set of components a run was scored on, such as "checks+rubric".
 */
function pairCells(headRows, baseRows, weights) {
  const cells = new Map();
  const slot = (r) => {
    const key = cellKey(r);
    if (!cells.has(key)) cells.set(key, { cell: key, task: r.task, head: [], base: [], headSigs: new Map(), baseSigs: new Map() });
    return cells.get(key);
  };
  for (const [side, rows] of [['head', headRows], ['base', baseRows]]) {
    for (const r of rows) {
      const c = slot(r);
      if (isNonScored(r, weights)) continue;
      const q = qualityOfRun({ hidden: r.hidden, checks: r.checks, rubric: r.rubric }, weights);
      c[side].push(q.score);
      // A failed run with nothing to score is a filled-in zero, not a scoring on some components, so it carries no signature.
      if (r.zeroFilled) continue;
      const sig = q.used.join('+');
      c[`${side}Sigs`].set(sig, (c[`${side}Sigs`].get(sig) || 0) + 1);
    }
  }
  return [...cells.values()];
}

/** Arms are comparable only when every cell was scored on one set of components on both sides. */
function componentCheck(cells, headName = 'the arm') {
  const fmt = (m) => ([...m].map(([sig, n]) => `${n} x ${sig}`).join(', ') || 'no scored run');
  const bad = cells.filter((c) => new Set([...c.headSigs.keys(), ...c.baseSigs.keys()]).size > 1);
  if (!bad.length) return { ok: true, cells: [], reason: null };
  const shown = bad.slice(0, 3).map((c) => `${c.task}: ${headName} ${fmt(c.headSigs)}; vanilla ${fmt(c.baseSigs)}`);
  const more = bad.length > shown.length ? `, and ${bad.length - shown.length} more` : '';
  return { ok: false, cells: bad.map((c) => c.task), reason: `${headName === 'the arm' ? 'the arm' : headName} and vanilla were scored on different components in ${bad.length} cell(s) (${shown.join(' | ')}${more}), so their scores are not comparable` };
}

function perCellMin(rows) {
  const per = new Map();
  for (const r of rows) per.set(`${r.src}|${r.task}`, (per.get(`${r.src}|${r.task}`) || 0) + 1);
  return per.size ? Math.min(...per.values()) : 0;
}

function armOrder(input) {
  const present = [...new Set(input.rows.map((r) => r.armId))];
  const cfg = (input.run.config.armIds || []).filter((a) => present.includes(a));
  return [...cfg, ...present.filter((a) => !cfg.includes(a)).sort()];
}

/** Arms of one directory that share a commit or tree and a config: the first is the primary, the others its A/A repeats. */
function aaGroups(input, baselineId) {
  const byIdentity = new Map();
  for (const armId of armOrder(input)) {
    if (armId === baselineId) continue;
    const sample = input.rows.find((r) => r.armId === armId);
    const id = sample && (sample.commitSha || sample.contentHash) ? `${sample.commitSha}|${sample.contentHash}|${JSON.stringify(sample.armConfig ?? null)}` : null;
    if (id) byIdentity.set(id, [...(byIdentity.get(id) || []), armId]);
  }
  return [...byIdentity.values()].filter((g) => g.length > 1);
}

function combineGraded(parts) {
  const ok = parts.filter((p) => p && p.n > 0);
  if (!ok.length) return null;
  const n = ok.reduce((s, p) => s + p.n, 0);
  const w = (k) => ok.reduce((s, p) => s + p[k] * p.n, 0) / n;
  const dis = ok.reduce((s, p) => s + p.orderDisagreements, 0);
  return { n, armGrade: w('armGrade'), baseGrade: w('baseGrade'), delta: w('delta'), orderDisagreements: dis, disagreementRate: dis / n, errors: parts.reduce((s, p) => s + (p?.errors || 0), 0) };
}

function sentenceFor(a, baseLabel) {
  if (a.aaRepeatOf) return `A/A repeat of ${a.aaRepeatOf}. It exists to measure run-to-run noise, so it gets no verdict.`;
  if (a.verdict === NEE) return `Not enough evidence. ${a.reason}.`;
  const dir = a.quality.delta > 0 ? 'higher' : 'lower';
  const cost = a.cost.ratio === null ? '' : ` It cost ${a.cost.ratio.toFixed(2)}x the credits per successful run (95% interval ${a.cost.ciLow.toFixed(2)} to ${a.cost.ciHigh.toFixed(2)}, limit ${COST_MAX.toFixed(1)}x).`;
  const verb = a.verdict === KEEP ? 'Keep' : 'Discard';
  return `${verb}. ${a.label} scored ${f1(Math.abs(a.quality.delta))} points ${dir} than ${baseLabel} (paired 95% interval of the difference ${f1(a.quality.deltaCiLow)} to ${f1(a.quality.deltaCiHigh)} over ${a.quality.k} task cells), outside the A/A noise of ${f1(a.noise.pts)} points, over ${a.quality.n} runs against ${a.quality.baseN} at ${a.minReps} or more replicates per cell.${cost}`;
}

/**
 * dirs: run directories (each a finished run, usually one per suite). Returns the verdict data:
 * { baselineLabel, arms: [one entry per arm label], dirs, skippedDirs, notes, unit, rules }.
 */
function buildVerdict({ dirs, benchDir, extraDirs = [], baseline = 'vanilla', scoringFile, profile = null }) {
  const tasks = loadTasks(benchDir, { extraDirs });
  const weights = loadScoring(scoringFile);
  const inputs = [];
  const skippedDirs = [];
  for (const d of dirs) {
    const run = loadRun(d);
    if (!run.runs.some((r) => r.armId === baseline)) {
      skippedDirs.push({ dir: run.dir, reason: `no run of the baseline arm "${baseline}" (arms present: ${[...new Set(run.runs.map((r) => r.armId))].join(', ')})` });
      continue;
    }
    const a = analyze({ run, tasks, baseline, scoringFile });
    const src = inputs.length;
    inputs.push({ src, dir: run.dir, run, a, rows: a.rows.map((r) => normalize(r, src)), ledger: readLedger(run.dir), controls: readOptional(path.join(run.dir, 'controls-check.json')) });
  }
  if (!inputs.length) throw new Error(`no run directory has the baseline arm "${baseline}"`);

  const all = inputs.flatMap((i) => i.rows);
  const unit = inputs[0].a.scores.unit;
  const baseRows = all.filter((r) => r.armId === baseline);
  const baselineLabel = [...new Set(baseRows.map((r) => r.label))].join(' + ');
  const labels = [...new Set(all.filter((r) => r.armId !== baseline).map((r) => r.label))];

  // A/A pairs per directory, with the pooled quality of each side per pair label.
  const pairs = new Map();
  const repeatOf = new Map();
  for (const input of inputs) {
    for (const g of aaGroups(input, baseline)) {
      const [primary, ...repeats] = g;
      const pl = refLabel({ armId: primary, ...input.rows.find((r) => r.armId === primary) });
      const slot = pairs.get(pl) || { primary: pl, a: [], b: [], dirs: new Set(), repeats: new Set() };
      slot.a.push(...qualityList(input.rows.filter((r) => r.armId === primary), weights));
      for (const rep of repeats) {
        slot.b.push(...qualityList(input.rows.filter((r) => r.armId === rep), weights));
        const rl = refLabel({ armId: rep, ...input.rows.find((r) => r.armId === rep) });
        slot.repeats.add(rl);
        repeatOf.set(rl, pl);
      }
      slot.dirs.add(input.src);
      pairs.set(pl, slot);
    }
  }

  const arms = labels.map((label) => {
    const headAll = all.filter((r) => r.label === label);
    const headDirs = [...new Set(headAll.map((r) => r.src))];
    const cells = new Set(headAll.map((r) => `${r.src}|${r.task}`));
    const head = headAll;
    const base = baseRows.filter((r) => cells.has(`${r.src}|${r.task}`));
    const common = new Set(base.map((r) => `${r.src}|${r.task}`));
    const headC = head.filter((r) => common.has(`${r.src}|${r.task}`));
    const out = { label, armId: headC[0]?.armId ?? headAll[0].armId, aaRepeatOf: repeatOf.get(label) ?? null, dirs: headDirs.map((s) => inputs[s].dir), commitSha: headAll[0].commitSha, contentHash: headAll[0].contentHash };
    const nCells = common.size;
    const renamed = [...headC.map((r) => ({ ...r, arm: 'head' })), ...base.map((r) => ({ ...r, arm: 'base' }))];
    const sc = nCells ? computeScores({ rows: renamed, baseline: 'base', weights, unit }) : null;
    const h = sc?.arms.head?.overall;
    const b = sc?.arms.base?.overall;
    const hq = qualityList(headC, weights);
    const bq = qualityList(base, weights);
    const pcells = pairCells(headC, base, weights);
    const dq = pairedCellCI(pcells.map((c) => ({ head: c.head, base: c.base })));
    const unpaired = diffCI(hq, bq);
    const components = componentCheck(pcells);
    const nonScored = { head: nonScoredOf(headC, weights), base: nonScoredOf(base, weights) };
    const rel = (rs) => rs.map((r) => (['timeout', 'error', 'infraError', 'modelMismatch'].includes(r.outcome) ? 0 : 100));
    const relCells = [...new Set(headC.map(cellKey))].map((key) => ({ head: rel(headC.filter((r) => cellKey(r) === key)), base: rel(base.filter((r) => cellKey(r) === key)) }));
    const dr = pairedCellCI(relCells);
    const eff = h?.efficiency;
    const cost = eff?.creditsPerSuccess;
    const wall = eff?.wall;
    const lowRows = headC.length ? perCellMin(headC) : 0;
    const minReps = nCells ? Math.min(lowRows, perCellMin(base)) : 0;

    const groups = [...pairs.values()].filter((p) => [...p.dirs].some((s) => headDirs.includes(s)));
    const spreads = groups.map((p) => (p.a.length && p.b.length ? Math.abs(mean(p.a) - mean(p.b)) : null)).filter(fin);
    const noise = spreads.length
      ? { available: true, spread: Math.max(...spreads), pts: Math.max(Math.max(...spreads), NOISE_FLOOR_PTS), pairs: groups.map((p) => ({ arm: p.primary, repeats: [...p.repeats], runsA: p.a.length, runsB: p.b.length, spread: p.a.length && p.b.length ? Math.abs(mean(p.a) - mean(p.b)) : null })) }
      : { available: false, spread: null, pts: null, pairs: [] };

    const ratingBy = headDirs.map((s) => ({ dir: inputs[s].dir, rating: inputs[s].a.card.rating, blockers: inputs[s].a.card.blockers.map((x) => `${x.label} (${x.status})`), failed: inputs[s].a.card.blockers.filter((x) => x.status === 'FAIL').map((x) => `${x.label} (${x.status})`) }));
    const rating = lowest(ratingBy.map((r) => r.rating));
    const failures = Object.fromEntries(['good', ...FAILURE_OUTCOMES].map((k) => [k, headC.filter((r) => r.outcome === k).length]));
    const baseFailures = Object.fromEntries(['good', ...FAILURE_OUTCOMES].map((k) => [k, base.filter((r) => r.outcome === k).length]));

    const decision = decide({
      cells: nCells, pairedCells: dq.k, nHead: h?.quality.n ?? 0, nBase: b?.quality.n ?? 0, minReps, rating, ratingBy, noise, nonScored, components,
      quality: { delta: dq.delta, ciLow: dq.ciLow, ciHigh: dq.ciHigh, p: dq.p, pExact: dq.pExact }, reliability: { delta: dr.delta, ciLow: dr.ciLow, ciHigh: dr.ciHigh },
      cost: { ratio: cost?.ratio ?? null },
    });
    const graded = combineGraded(headDirs.map((s) => gradedSummary(inputs[s].run.judgments, { isStale: inputs[s].a.ctx.isStale }).arms[out.armId]));
    Object.assign(out, {
      runs: headC.length, baseRuns: base.length, cells: nCells, minReps, failures, baseFailures, failedAsZero: headC.filter((r) => r.zeroFilled).length, baseFailedAsZero: base.filter((r) => r.zeroFilled).length,
      budgetSkipped: headDirs.reduce((s, x) => s + inputs[x].a.facts.budget.skipped, 0),
      quality: { value: h?.quality.value ?? null, ciLow: h?.quality.ciLow ?? null, ciHigh: h?.quality.ciHigh ?? null, n: h?.quality.n ?? 0, baseValue: b?.quality.value ?? null, baseN: b?.quality.n ?? 0, delta: dq.delta, deltaCiLow: dq.ciLow, deltaCiHigh: dq.ciHigh, k: dq.k, droppedCells: dq.droppedCells, method: dq.method, p: dq.p, pExact: dq.pExact, unpaired: { delta: unpaired.delta, ciLow: unpaired.ciLow, ciHigh: unpaired.ciHigh, note: 'descriptive only: treats every run as independent' }, excluded: h?.quality.excluded ?? null },
      reliability: { value: h?.reliability.value ?? null, baseValue: b?.reliability.value ?? null, delta: dr.delta, ciLow: dr.ciLow, ciHigh: dr.ciHigh, n: h?.reliability.n ?? 0 },
      autonomy: h?.autonomy ? { value: h.autonomy.value, baseValue: b?.autonomy?.value ?? null, n: h.autonomy.n, baseN: b?.autonomy?.n ?? 0, interjectionsPerTask: h.autonomy.interjectionsPerTask } : null,
      cost: { ratio: cost?.ratio ?? null, ciLow: cost?.ciLow ?? null, ciHigh: cost?.ciHigh ?? null, perSuccess: cost?.value ?? null, basePerSuccess: cost?.baseValue ?? null, n: cost?.n ?? 0, unit: unit === 'USD' ? 'USD' : 'credits' },
      latency: { ratio: wall?.ratio ?? null, ciLow: wall?.ciLow ?? null, ciHigh: wall?.ciHigh ?? null, seconds: fin(wall?.value) ? wall.value / 1000 : null, baseSeconds: fin(wall?.baseValue) ? wall.baseValue / 1000 : null },
      noise, nonScored, components, diligence: { rating, byDir: ratingBy }, graded,
      verdict: out.aaRepeatOf ? null : decision.verdict, reason: out.aaRepeatOf ? null : decision.reason, reasons: out.aaRepeatOf ? [] : decision.reasons,
    });
    out.sentence = sentenceFor(out, baselineLabel);
    return out;
  });

  const notes = [];
  const byId = new Map();
  for (const a of arms) byId.set(a.armId, [...(byId.get(a.armId) || []), a.label]);
  for (const [id, ls] of byId) if (ls.length > 1) notes.push(`${id} appears at ${ls.length} commits: ${ls.join(', ')}. They are separate arms and are never merged.`);
  for (const s of skippedDirs) notes.push(`${s.dir} was left out: ${s.reason}.`);
  if (arms.some((a) => a.failedAsZero)) notes.push('A run that failed or timed out with nothing to score counts as quality 0. Infra errors and model mismatches are left out of quality and listed, and a side with more than a fifth of its runs in that state gets no call.');

  const dirInfo = inputs.map((i) => {
    const check = profile ? profileCheck(profile, { facts: i.a.facts, judgments: i.run.judgments }) : null;
    return {
      dir: i.dir, suite: i.run.config.suite ?? null, model: i.run.config.model ?? null, rating: i.a.card.rating, counts: i.a.card.counts, runs: i.rows.length,
      arms: [...new Set(i.rows.map((r) => r.label))], ledger: i.ledger.exists ? i.ledger.totals : null, controls: i.controls, profile: check ? { name: profile.name, met: check.met, items: check.items } : null,
      judges: i.a.facts.judging.judges, profileName: i.run.config.profile?.name ?? null,
    };
  });
  return { schemaVersion: 1, baseline, baselineLabel, unit: unit === 'USD' ? 'USD' : 'credits', arms, dirs: dirInfo, skippedDirs, notes, weights, noiseFloorPts: NOISE_FLOOR_PTS };
}

module.exports = { buildVerdict, decide, refLabel, sentenceFor, normalize, qualityList, aaGroups, armOrder, perCellMin, pairCells, nonScoredOf, componentCheck, cellKey, KEEP, DISCARD, NEE, NOISE_FLOOR_PTS, MAX_NONSCORED_SHARE, COST_MAX };
