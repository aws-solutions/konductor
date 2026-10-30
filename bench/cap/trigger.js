// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap trigger`: query sources, live trigger tasks and how their results are read, the cross-check sample, the report.

const fs = require('node:fs');
const path = require('node:path');
const { mulberry32, shuffle } = require('../runner/lib/orchestrate.js');
const { wilson } = require('./score.js');

const SPLITS = ['train', 'heldout', 'all'];
const NEUTRAL_FIXTURE = 'trigger-neutral';

const lower = (s) => String(s).toLowerCase();

/** The registry entry's queries for a split. `all` is train plus heldout; the reserve is kept for the final exam. */
function queriesFromRegistry(entry, split = 'all') {
  if (!SPLITS.includes(split)) throw new Error('--split takes train, heldout or all');
  const all = entry?.trigger?.queries ?? [];
  if (!all.length) throw new Error(`${entry?.id ?? 'the capability'} has no trigger queries; add them from a reviewed draft (cap draft, then copy the approved queries into bench/capabilities/)`);
  const picked = all.filter((q) => (split === 'all' ? q.split === 'train' || q.split === 'heldout' : q.split === split));
  if (!picked.length) throw new Error(`${entry.id} has no ${split} queries`);
  return picked.map((q) => ({ id: q.id, text: q.text, expect: q.expect, split: q.split, ...(q.nearMissOf ? { nearMissOf: q.nearMissOf } : {}) }));
}

/** Queries straight from a `cap draft` / `cap import` file, so a run can start before review. Drafts carry no split. */
function queriesFromDraft(file, capId) {
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read the drafts file ${file}: ${e.code || e.message}`); }
  if (!d || !Array.isArray(d.queries)) throw new Error(`${file} has no queries array`);
  if (d.capId && d.capId !== capId) throw new Error(`the draft is for ${d.capId}, not ${capId}`);
  return d.queries.map((q) => ({ id: q.id, text: q.text, expect: q.expect, ...(q.split ? { split: q.split } : {}), ...(q.nearMissOf ? { nearMissOf: q.nearMissOf } : {}) }));
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'q';

/**
 * Writes one trigger task per query into `dir` (an --extra-tasks directory) with a small neutral fixture. The prompt is the
 * query; there are no checks because the run is read from its stream. Returns [{ taskId, query }].
 */
function materializeTasks({ cap, queries, dir }) {
  fs.mkdirSync(path.join(dir, 'fixtures', NEUTRAL_FIXTURE), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixtures', NEUTRAL_FIXTURE, 'NOTES.txt'), 'Scratch notes for a small project.\n');
  fs.writeFileSync(path.join(dir, 'fixtures', NEUTRAL_FIXTURE, '.bench-answer-key.md'), 'No answer: a trigger task is read from which capability the agent reaches for.\n');
  const used = new Set();
  return queries.map((q) => {
    let taskId = `trg-${slug(cap.id.replace(':', '-'))}-${slug(q.id)}`;
    for (let n = 2; used.has(taskId); n++) taskId = `trg-${slug(cap.id.replace(':', '-'))}-${slug(q.id)}-${n}`;
    used.add(taskId);
    const task = {
      id: taskId, class: 'trigger', target: cap.name, prompt: q.text, fixture: NEUTRAL_FIXTURE, timeoutSec: 300, checks: [], rubric: [], tiers: ['cap'],
      triggerQuery: { capId: cap.id, queryId: q.id, ...(q.split ? { split: q.split } : {}), expect: q.expect },
    };
    fs.writeFileSync(path.join(dir, `${taskId}.json`), `${JSON.stringify(task, null, 2)}\n`);
    return { taskId, query: q };
  });
}

// ---- reading live results ----

/** One scored row from a result.json of a trigger run, or null when the capability kind cannot be read from it. */
function liveRow(result, cap) {
  const inv = result.capInvocation ?? {};
  const name = lower(cap.name);
  const names = new Set(cap.kind === 'sop' ? [name, `sop-${name}`] : [name]);
  const loaded = (result.skillsLoaded ?? []).map((s) => s.name);
  const requested = inv.requested ?? [];
  const delegated = (inv.delegatedTo ?? []).map((d) => d.agent);
  const identified = inv.identified ?? [];
  let hit;
  if (cap.kind === 'agent') hit = delegated.some((a) => lower(a) === name);
  else hit = [...loaded, ...requested].some((n) => names.has(lower(n))) || (cap.kind === 'sop' && identified.some((n) => lower(n) === name));
  const others = [...new Set([...loaded, ...requested, ...delegated, ...identified])].filter((n) => !names.has(lower(n)));
  const q = result.triggerQuery;
  return {
    queryId: q.queryId, expect: q.expect, rep: q.rep ?? result.replicate, split: q.split ?? null, hit, fired: others,
    firstDecision: inv.firstDecision ?? { kind: 'none', name: null }, earlyStopped: (result.flags ?? []).includes('earlyStopped'), credits: result.credits ?? null,
    censored: Boolean(result.creditsCensored),
  };
}

function liveRows(results, cap) {
  const dropped = { notRun: 0, noQuery: 0, infra: 0 };
  const rows = [];
  for (const r of results) {
    if (r.status === 'budget_skipped') { dropped.notRun++; continue; }
    if (!r.triggerQuery) { dropped.noQuery++; continue; }
    if (r.infraError || !r.capInvocation) { dropped.infra++; continue; }
    rows.push(liveRow(r, cap));
  }
  return { rows, dropped };
}

/** How the runs began: counts of first decision kinds, from result.json objects or rows. */
function firstDecisions(items) {
  const out = {};
  for (const it of items) {
    const kind = (it.capInvocation ?? it).firstDecision?.kind ?? 'none';
    out[kind] = (out[kind] || 0) + 1;
  }
  return out;
}

// ---- cross-check ----

/** A seeded sample of about `fraction` of the queries with every non-empty group (should load, near miss, other should-not) present. */
function crossCheckSample(queries, fraction, seed = 1) {
  if (!(fraction >= 0 && fraction <= 1)) throw new Error('--crosscheck must be between 0 and 1');
  if (fraction === 0 || !queries.length) return [];
  const groups = [
    queries.filter((q) => q.expect === 'load'),
    queries.filter((q) => q.expect === 'none' && q.nearMissOf),
    queries.filter((q) => q.expect === 'none' && !q.nearMissOf),
  ].filter((g) => g.length);
  const total = Math.min(queries.length, Math.max(groups.length, Math.round(fraction * queries.length)));
  const exact = groups.map((g) => (g.length * total) / queries.length);
  const take = exact.map((x, i) => Math.min(groups[i].length, Math.max(1, Math.floor(x))));
  let left = total - take.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rem: x - Math.floor(x) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let pass = 0; left > 0 && pass < 3; pass++) {
    for (const { i } of order) { if (left > 0 && take[i] < groups[i].length) { take[i]++; left--; } }
  }
  const rand = mulberry32(seed);
  return groups.flatMap((g, i) => shuffle(g, rand).slice(0, take[i]));
}

/** Proxy and live predictions per query id, for the queries that both scored. */
function crossPairs(proxyScore, liveScore) {
  const live = new Map(liveScore.queries.map((q) => [q.queryId, q.predicted]));
  return proxyScore.queries.filter((q) => live.has(q.queryId)).map((q) => ({ queryId: q.queryId, proxy: q.predicted, live: live.get(q.queryId) }));
}

// ---- report ----

const f2 = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(2));
const ratioText = (name, r) => `${name} ${f2(r.value)}${r.value === null ? '' : ` (Wilson 95% ${f2(r.lo)} to ${f2(r.hi)}, n=${r.n})`}`;
const pad = (rows) => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => `| ${r.map((c, i) => String(c).padEnd(w[i])).join(' | ')} |`);
};

function renderTriggerReport({ cap, harness, mode, split, reps, score, proxy = null, credits = 0, calls = null, label = null, model = null, surface = null, censored = 0, firstDecisions: first = null, crossCheck = null, skipped = 0 }) {
  const L = [`# Trigger test: ${cap.id}`, ''];
  L.push(`harness: ${harness}; mode: ${mode}; split: ${split}; reps: ${reps}${model ? `; model: ${model}` : ''}`);
  if (surface) L.push(`surface: ${surface}`);
  if (mode === 'proxy') L.push(label ?? 'proxy not validated (no cross-check against live runs yet)');
  L.push('', `queries: ${score.queries.length} (${score.queries.filter((q) => q.expect === 'load').length} should load, ${score.queries.filter((q) => q.expect === 'none').length} should not)${skipped ? `; ${skipped} repeat(s) not run because the credit budget was reached` : ''}`);
  L.push(ratioText('precision', score.precision), ratioText('recall', score.recall), `${ratioText('F1', score.f1)} (approximate: Wilson on 2TP of 2TP+FP+FN)`);
  L.push(`counts: TP ${score.tp}, FP ${score.fp}, FN ${score.fn}, TN ${score.tn}`);
  if (score.queries.length < 30) L.push(`With ${score.queries.length} queries the intervals are wide at this size; read them as a guide.`);
  if (proxy) {
    L.push('', '## Why should-load queries were missed', '');
    L.push(`- retrieval failures (the candidate list lacked the capability): ${proxy.retrievalFailures}`);
    L.push(`- judgment failures (the candidate list had it and the model did not pick it): ${proxy.judgmentFailures}`);
    L.push(`- no search (the model chose not to look): ${proxy.noSearch}`);
    L.push(`- false triggers (picked on a should-not query): ${proxy.falseTriggers}`);
    L.push(`- unusable replies: ${proxy.errors}`);
  }
  if (first) L.push('', `first decisions: ${Object.entries(first).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (score.confusion.length) {
    L.push('', '## What fired instead', '', `Counts by capability: ${Object.entries(score.confusionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
    for (const c of score.confusion) L.push(`- ${c.queryId} (expected ${c.expect}): ${Object.entries(c.fired).map(([k, v]) => `${k} x${v}`).join(', ')}`);
  }
  L.push('', '## Per query', '', ...pad([['query', 'expect', 'near miss of', 'fired', 'rate', 'result'], ...score.queries.map((q) => [q.queryId, q.expect, q.nearMissOf ?? '-', `${q.hits}/${q.reps}`, f2(q.rate), q.pass ? 'ok' : 'WRONG'])]));
  if (crossCheck) L.push('', '## Proxy against live', '', `${crossCheck.label}; percent agreement ${crossCheck.agreement === null ? 'n/a' : `${Math.round(crossCheck.agreement * 100)}%`}; kappa ${f2(crossCheck.kappa)}; n=${crossCheck.n}`);
  L.push('', `${f2(credits)} credits${calls !== null ? ` over ${calls} model calls` : ''}.${censored ? ` ${censored} early-stopped run(s) report no metered credits, so their cost is not in this figure.` : ''}`);
  return `${L.join('\n')}\n`;
}

module.exports = {
  queriesFromRegistry, queriesFromDraft, materializeTasks, liveRow, liveRows, firstDecisions, crossCheckSample, crossPairs, renderTriggerReport, NEUTRAL_FIXTURE, SPLITS, wilson,
};
