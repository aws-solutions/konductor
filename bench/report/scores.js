// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scores per arm, overall and per task class. Pure functions over run rows (see rows.js). Every score carries
// its n and a 95% bootstrap interval, names the inputs it used, and is labelled anecdotal below 3 runs. A
// failed run is never dropped silently: reliability counts it, and quality lists what it left out and why.

const fs = require('node:fs');
const path = require('node:path');
const { meanCI, ratioBootstrap } = require('./stats.js');
const { QUOTE_RULES, DEFAULT_QUOTE_RULE } = require('../judge/quote.js');

const MIN_N = 3;
const CEILING = 95;
const DEFAULT_WEIGHTS = { hidden: 0.5, checks: 0.2, rubric: 0.3 };
const COMPONENTS = Object.keys(DEFAULT_WEIGHTS);
// An opt-in fourth component: the quality-pack score of a run. It exists only in a scoring file that gives it a weight, and
// only report and report-2x2 with --criteria-pack can supply it.
const PACK_COMPONENT = 'pack';
// How a run's checks become the checks component. 'all' (the default) is 1 when every check passed, else 0. 'fraction' is
// passed / total. The loaded weights carry `checksMode` only when it is 'fraction', so default weights are unchanged.
const CHECKS_MODES = ['all', 'fraction'];
const CHECKS_MODE_KEY = 'checksMode';
// How the judge's evidence quotes are matched: 'lenient' (the default, tightened) or 'strict'. Both views live in the
// judgments (see judge/views.js); the rule only picks which one the scores read. The loaded weights carry `quoteMode` only
// when it is 'strict', the non-default, so a default scoring file loads to the same object as before.
const QUOTE_MODES = QUOTE_RULES;
const QUOTE_MODE_KEY = 'quoteMode';
const STRICT_QUOTES = 'strict';
const FRACTIONAL_CHECKS = 'fraction';
const componentsOf = (weights) => (weights[PACK_COMPONENT] > 0 ? [...COMPONENTS, PACK_COMPONENT] : COMPONENTS);
const DEFAULT_PROFILE = path.join(__dirname, '..', 'profiles', 'scoring.json');
const RELIABILITY_FAILS = ['timeout', 'error', 'infraError', 'modelMismatch'];

const FORMULAS = {
  quality: 'Per run, the weighted mean of the components the run has, times 100: hidden tests (FAIL_TO_PASS, hiddenTests, or intendedTests, as passed / total), checks (1 when every check passed, else 0), rubric (mean over judges of the verified score, 0..1). Weights come from profiles/scoring.json (default 0.5, 0.2, 0.3). A missing component is dropped and the remaining weights are renormalised; nothing is imputed. Runs with infraError or modelMismatch, and runs with no component at all, are left out and counted in "excluded". The arm score is the mean over runs with a 95% bootstrap interval.',
  reliability: '100 minus the share of executed runs that timed out, errored, hit infraError or had a modelMismatch. A run whose checks failed still counts as reliable; the miss shows in quality.',
  autonomy: 'Autonomy-tier runs only (turns > 0): the share of runs with completedWithoutHelp (no scripted reply needed and every intended and invariant test passed), times 100. Shown beside it: mean interjections per task and the share of runs that asked a question on a task that needs none.',
  efficiency: 'Not a 0..100 number. Each metric is head / base for the same scope: cost per successful run (all charged cost over clean passes; credits, or USD on opencode), then mean wall clock, model calls, work tool calls and subagent calls over clean passes. The interval is a 95% bootstrap of the ratio. "Cost per quality point" is cost per successful run divided by the quality score; at quality 95 or above it mostly measures cost and says so.',
  capability: 'For cap prune-report: load rate = runs that loaded the skill / runs that could load it, with a Wilson 95% interval, the exposure n, the skill size in bytes, the class and the evidence verdict. No composite number is made.',
};

// The cost figure of a Claude Code cell is the list-price USD Claude Code reports; the shared text names credits and opencode.
function formulasForClaudeCode() {
  const efficiency = FORMULAS.efficiency.replace('credits, or USD on opencode', 'USD at list price, as Claude Code reports it');
  return { ...FORMULAS, efficiency };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const FRACTIONAL_CHECKS_FORMULA = (text) => text.replace('checks (1 when every check passed, else 0)', 'checks (passed / total, because the scoring file sets "checks": "fraction")');

const PACK_FORMULA = ' Pack quality (opt-in, set by a weight for "pack" in the scoring file): per run, the weighted mean over the quality-pack criteria that applied (pass 1, partial 0.5, fail 0, weighted by criterion), averaged over the judges, 0..1. A run where no criterion applied has no pack component and the other weights are renormalised, as for any missing component.';

/**
 * Weights file: { weights: { hidden, checks, rubric, pack? }, checks?: "all" | "fraction" }. Each weight is a number of 0 or more, at
 * least one above 0. A weight above 0 for pack is refused unless the caller can supply pack scores (allowPack), so a command that
 * cannot never drops the component quietly. "checks" names how the checks component is scored (default "all"); the returned object
 * gets `checksMode: "fraction"` only when the file asks for it. "quotes" names the evidence-quote rule ("lenient", the default, or
 * "strict"); the returned object gets `quoteMode: "strict"` only for strict.
 */
function loadScoring(file = DEFAULT_PROFILE, { allowPack = false } = {}) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`scoring profile ${file}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`); }
  const w = data?.weights;
  if (!w || typeof w !== 'object' || Array.isArray(w)) throw new Error(`scoring profile ${file}: "weights" must be an object`);
  const known = [...COMPONENTS, PACK_COMPONENT];
  for (const k of Object.keys(w)) if (!known.includes(k)) throw new Error(`scoring profile ${file}: unknown component "${k}" (known: ${known.join(', ')})`);
  const out = {};
  for (const k of known) {
    const v = w[k] ?? 0;
    if (!finite(v) || v < 0) throw new Error(`scoring profile ${file}: weight for ${k} must be a number of 0 or more`);
    if (k !== PACK_COMPONENT || v > 0) out[k] = v;
  }
  if (out[PACK_COMPONENT] > 0 && !allowPack) throw new Error(`scoring profile ${file}: a weight for pack needs the quality-pack scores, which only report, report --verdict and report-2x2 with --criteria-pack provide`);
  if (!known.some((k) => out[k] > 0)) throw new Error(`scoring profile ${file}: at least one weight must be above 0`);
  const mode = data.checks ?? 'all';
  if (!CHECKS_MODES.includes(mode)) throw new Error(`scoring profile ${file}: "checks" must be one of ${CHECKS_MODES.map((m) => `"${m}"`).join(', ')}`);
  if (mode === FRACTIONAL_CHECKS) out[CHECKS_MODE_KEY] = mode;
  const quotes = data.quotes ?? DEFAULT_QUOTE_RULE;
  if (!QUOTE_MODES.includes(quotes)) throw new Error(`scoring profile ${file}: "quotes" must be one of ${QUOTE_MODES.map((m) => `"${m}"`).join(', ')}`);
  if (quotes === STRICT_QUOTES) out[QUOTE_MODE_KEY] = quotes;
  return out;
}

/** The evidence-quote rule a loaded scoring object asks for. */
const quoteRuleOf = (weights) => weights?.[QUOTE_MODE_KEY] ?? DEFAULT_QUOTE_RULE;

/** The checks component of one run, 0..1, or null when it ran no checks. `checks` is the result's list of { passed }. */
function checksScore(checks, weights = DEFAULT_WEIGHTS) {
  if (!Array.isArray(checks) || !checks.length) return null;
  const passed = checks.filter((c) => c.passed).length;
  return weights[CHECKS_MODE_KEY] === FRACTIONAL_CHECKS ? passed / checks.length : passed === checks.length ? 1 : 0;
}

/** Text appended after the checks weight in a scoring line; empty for the default mode so default output is unchanged. */
const checksModeNote = (weights) => (weights?.[CHECKS_MODE_KEY] === FRACTIONAL_CHECKS ? ' (scored as passed / total)' : '');

/** `formulas` with the checks wording of the mode in use; the same object when the mode is the default. */
const formulasForWeights = (formulas, weights) => (weights?.[CHECKS_MODE_KEY] === FRACTIONAL_CHECKS ? { ...formulas, quality: FRACTIONAL_CHECKS_FORMULA(formulas.quality) } : formulas);

/** { score 0..100, used: [component names] } for one run (a row or any object with the component values), or null when it has no weighted component. */
function qualityOfRun(parts, weights = DEFAULT_WEIGHTS) {
  const used = componentsOf(weights).filter((k) => finite(parts[k]) && (weights[k] ?? 0) > 0);
  if (!used.length) return null;
  const total = used.reduce((n, k) => n + weights[k], 0);
  return { score: (used.reduce((n, k) => n + weights[k] * parts[k], 0) / total) * 100, used };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (v, d = 0) => (v === null || v === undefined ? 'n/a' : `${v.toFixed(d)}`);

function qualityBlock(rows, weights) {
  const excluded = { infraError: 0, modelMismatch: 0, noComponents: 0 };
  const scores = [];
  const active = componentsOf(weights);
  const comp = Object.fromEntries(active.map((k) => [k, { n: 0, weight: weights[k] }]));
  const raws = [];
  for (const r of rows) {
    if (r.outcome === 'infraError' || r.outcome === 'modelMismatch') { excluded[r.outcome]++; continue; }
    const q = qualityOfRun(r, weights);
    if (!q) { excluded.noComponents++; continue; }
    scores.push(q.score);
    for (const k of q.used) comp[k].n++;
    if (finite(r.rubricRaw)) raws.push(r.rubricRaw);
  }
  const ci = scores.length ? meanCI(scores) : { mean: null, ciLow: null, ciHigh: null };
  const n = scores.length;
  const used = active.filter((k) => comp[k].n > 0);
  const left = Object.entries(excluded).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`);
  return {
    value: ci.mean, ciLow: ci.ciLow, ciHigh: ci.ciHigh, n, anecdotal: n < MIN_N, ceiling: ci.mean !== null && ci.mean >= CEILING,
    components: comp, excluded, rubricRawMean: raws.length ? mean(raws) * 100 : null,
    inputs: n
      ? `${used.map((k) => `${k} ${comp[k].n}/${n} (w ${weights[k]})`).join(', ')}; weights renormalised per run${raws.length ? `; raw rubric ${pct(mean(raws) * 100, 1)}` : ''}${left.length ? `; left out: ${left.join(', ')}` : ''}`
      : `no scorable run${left.length ? `; left out: ${left.join(', ')}` : ''}`,
  };
}

function reliabilityBlock(rows) {
  const n = rows.length;
  const counts = Object.fromEntries(RELIABILITY_FAILS.map((k) => [k, rows.filter((r) => r.outcome === k).length]));
  const bad = Object.values(counts).reduce((a, b) => a + b, 0);
  const ci = n ? meanCI(rows.map((r) => (RELIABILITY_FAILS.includes(r.outcome) ? 0 : 100))) : { mean: null, ciLow: null, ciHigh: null };
  return {
    value: ci.mean, ciLow: ci.ciLow, ciHigh: ci.ciHigh, n, anecdotal: n < MIN_N, counts,
    inputs: n ? `${n - bad} of ${n} runs finished cleanly${bad ? `; ${RELIABILITY_FAILS.filter((k) => counts[k]).map((k) => `${counts[k]} ${k}`).join(', ')}` : ''}` : 'no runs',
  };
}

function autonomyBlock(rows) {
  const a = rows.filter((r) => r.turns > 0);
  if (!a.length) return null;
  const ci = meanCI(a.map((r) => (r.completedWithoutHelp === true ? 100 : 0)));
  const nq = a.filter((r) => r.noQuestionTask);
  const unnecessary = nq.length ? nq.filter((r) => r.questionsAsked > 0).length / nq.length : null;
  const inter = mean(a.map((r) => (finite(r.interjections) ? r.interjections : 0)));
  return {
    value: ci.mean, ciLow: ci.ciLow, ciHigh: ci.ciHigh, n: a.length, anecdotal: a.length < MIN_N,
    interjectionsPerTask: inter, unnecessaryQuestionRate: unnecessary, unnecessaryQuestionN: nq.length,
    inputs: `${a.filter((r) => r.completedWithoutHelp === true).length} of ${a.length} completed without help; ${pct(inter, 2)} interjections per task; unnecessary questions ${unnecessary === null ? 'n/a (no no-question task)' : `${Math.round(unnecessary * nq.length)} of ${nq.length} runs`}`,
  };
}

// Metrics for the efficiency block: items are the rows each statistic runs over.
const EFFICIENCY = [
  { key: 'creditsPerSuccess', name: 'per successful run', items: 'all', stat: (xs) => { const g = xs.filter((r) => r.outcome === 'good').length; return g ? xs.reduce((n, r) => n + (finite(r.credits) ? r.credits : 0), 0) / g : null; } },
  { key: 'wall', name: 'wall clock', items: 'good', stat: (xs) => meanOf(xs, 'wall') },
  { key: 'modelCalls', name: 'model calls', items: 'good', stat: (xs) => meanOf(xs, 'modelCalls') },
  { key: 'workToolCalls', name: 'work tool calls', items: 'good', stat: (xs) => meanOf(xs, 'workToolCalls') },
  { key: 'subagentCalls', name: 'subagent calls', items: 'good', stat: (xs) => meanOf(xs, 'subagentCalls') },
];
function meanOf(xs, k) { const v = xs.map((r) => r[k]).filter(finite); return v.length ? mean(v) : null; }

function efficiencyBlock(rows, baseRows, baseQuality, quality, unit) {
  const out = {};
  for (const m of EFFICIENCY) {
    const pick = (xs) => (m.items === 'good' ? xs.filter((r) => r.outcome === 'good') : xs);
    const h = pick(rows);
    const b = pick(baseRows);
    const r = ratioBootstrap(h, b, m.stat);
    out[m.key] = { name: m.key === 'creditsPerSuccess' ? `${unit} ${m.name}` : m.name, value: r.head, baseValue: r.base, ratio: r.ratio, ciLow: r.ciLow, ciHigh: r.ciHigh, n: Math.min(h.length, b.length), nHead: h.length, nBase: b.length };
  }
  const per = out.creditsPerSuccess.value;
  const qv = quality.value;
  const cpq = per !== null && qv !== null && qv > 0 ? per / qv : null;
  const caveats = [];
  if (qv !== null && qv >= CEILING) caveats.push('quality is at ceiling, so this ratio mostly measures cost');
  if (baseQuality.value !== null && baseQuality.value >= CEILING && quality !== baseQuality) caveats.push('the base arm is at ceiling, so no quality gain is possible');
  out.creditsPerQualityPoint = { name: `${unit} per quality point`, value: cpq, caveat: caveats.join('; ') || null, n: quality.n };
  return out;
}

function flatRows(arms, scopes, baseline) {
  const out = [];
  const add = (arm, scope, name, o) => out.push({ arm, scope, name, value: o.value ?? null, ciLow: o.ciLow ?? null, ciHigh: o.ciHigh ?? null, n: o.n, inputs: o.inputs, anecdotal: o.n < MIN_N, unit: o.unit || '' });
  for (const [arm, byScope] of Object.entries(arms)) {
    for (const scope of scopes) {
      const c = byScope[scope];
      if (!c) continue;
      add(arm, scope, 'Quality', { ...c.quality, unit: '/100' });
      add(arm, scope, 'Reliability', { ...c.reliability, unit: '/100' });
      if (c.autonomy) add(arm, scope, 'Autonomy', { ...c.autonomy, unit: '/100' });
      for (const e of Object.values(c.efficiency)) {
        if (e.ratio === undefined) continue;
        const nm = `Cost ratio, ${e.name}`;
        add(arm, scope, nm, { value: e.ratio, ciLow: e.ciLow, ciHigh: e.ciHigh, n: e.n, unit: 'x', inputs: e.value === null ? 'no clean pass' : `${pct(e.value, 2)} vs base ${e.baseValue === null ? 'n/a' : pct(e.baseValue, 2)}${arm === baseline ? ' (the base)' : ''}` });
      }
      const q = c.efficiency.creditsPerQualityPoint;
      add(arm, scope, `Cost per quality point (${q.name.split(' ')[0]})`, { value: q.value, n: q.n, inputs: q.caveat || 'cost per successful run / quality score' });
    }
  }
  return out;
}

/**
 * rows: one record per executed run (rows.js). Returns { weights, formulas, baseline, scopes, arms, rows }.
 * arms[arm][scope] = { quality, reliability, autonomy|null, efficiency }.
 */
function computeScores({ rows, baseline, weights = DEFAULT_WEIGHTS, unit = 'credits', harness = null }) {
  const armIds = [...new Set(rows.map((r) => r.arm))];
  const classes = [...new Set(rows.map((r) => r.cls))];
  const scopes = ['overall', ...classes];
  const base = armIds.includes(baseline) ? baseline : armIds[0];
  const arms = {};
  for (const arm of armIds) {
    arms[arm] = {};
    for (const scope of scopes) {
      const mine = rows.filter((r) => r.arm === arm && (scope === 'overall' || r.cls === scope));
      if (!mine.length) continue;
      const baseRows = rows.filter((r) => r.arm === base && (scope === 'overall' || r.cls === scope));
      const quality = qualityBlock(mine, weights);
      const baseQuality = arm === base ? quality : qualityBlock(baseRows, weights);
      arms[arm][scope] = { quality, reliability: reliabilityBlock(mine), autonomy: autonomyBlock(mine), efficiency: efficiencyBlock(mine, baseRows, baseQuality, quality, unit) };
    }
  }
  const formulas = formulasForWeights(harness === 'claude-code' ? formulasForClaudeCode() : FORMULAS, weights);
  return { weights, unit, formulas: weights[PACK_COMPONENT] > 0 ? { ...formulas, quality: formulas.quality + PACK_FORMULA } : formulas, baseline: base, scopes, arms, rows: flatRows(arms, scopes, base) };
}

module.exports = { computeScores, qualityOfRun, loadScoring, quoteRuleOf, checksScore, checksModeNote, formulasForWeights, componentsOf, PACK_COMPONENT, DEFAULT_WEIGHTS, FORMULAS, MIN_N, CEILING, RELIABILITY_FAILS };
