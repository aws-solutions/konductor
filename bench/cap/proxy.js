// SPDX-License-Identifier: Apache-2.0
'use strict';

// Trigger proxy: asks a tool-less model call what it would load for a query, without starting an agent.
//
// kiro-cli has no skill index at startup, so the proxy has stages. (1) The model writes the find_skills arguments it would
// use. (2) The offline find_skills (retrieval.js) returns the candidates; this stage is free and deterministic, and when
// the capability is not among the candidates the failure is the wording of the description or the search words, not the
// model's judgment. (3) The model picks what to get_skill from the candidates. opencode puts the whole index in the
// prompt, so it is one call. A proxy cannot see task context, tool-use drift or subagent hops: a miss is informative,
// a hit is only a necessary condition.

const { judgeOnce } = require('../judge/run.js');
const { runPool } = require('../runner/lib/orchestrate.js');
const { findSkills } = require('./retrieval.js');

const MAX_SEARCHES = 3;

const FIND_SKILLS_CONTRACT = 'Search the skill catalog by name, keyword, or tag (substring/exact filters, not a ranker). All inputs are optional; when several are given, results must match all of them (AND). With none given, every indexed skill is returned. Returns metadata only, never a SKILL.md body.\nArguments: name = substring match against the skill name (case-insensitive); keyword = substring match against the name or the description (case-insensitive); tag = exact match against one tag (case-insensitive). An empty string is an error.';

function proxySupported(capId, harness) {
  const kind = capId.slice(0, capId.indexOf(':'));
  if (kind === 'skill') return { ok: true };
  if (kind === 'sop' && harness === 'opencode') return { ok: true };
  return { ok: false, reason: `the proxy models skill discovery only${harness === 'opencode' ? ' (skills and SOPs)' : ''}; ${capId} needs live mode` };
}

const tail = (query) => `User request:\n"""\n${query}\n"""`;

function stage1Prompt({ surface, query }) {
  const excerpt = surface.promptExcerpt ? `\nThe part of your instructions that mentions skills:\n"""\n${surface.promptExcerpt}\n"""\n` : '';
  return `You are a coding assistant. Before you start a task you may look for a skill that has instructions for it, using the tool find_skills on a skills server. The server holds ${surface.records.length} skills; you do not know their names or descriptions until you search.\n\nTool find_skills: ${FIND_SKILLS_CONTRACT}\n${excerpt}\n${tail(query)}\n\nDecide whether you would search for a skill before doing this work, and with which arguments (at most ${MAX_SEARCHES} calls). Reply with JSON only: {"searches":[{"keyword":"..."}]} or {"searches":[]} if you would not search. Each search object may have name, keyword and tag.`;
}

function stage3Prompt({ surface, query, candidates }) {
  const excerpt = surface.promptExcerpt ? `\nThe part of your instructions that mentions skills:\n"""\n${surface.promptExcerpt}\n"""\n` : '';
  const shown = candidates.map((c) => ({ name: c.name, description: c.description, tags: c.tags }));
  return `You are a coding assistant. You searched a skills server before starting a task. Tool get_skill loads the full instructions of one skill by exact name.\n${excerpt}\n${tail(query)}\n\nfind_skills returned:\n${JSON.stringify(shown, null, 1)}\n\nDecide which of these skills you would load with get_skill before doing the work. Load a skill only when its instructions would help with this request. Reply with JSON only: {"get_skill":["name"]} or {"get_skill":[]}.`;
}

function opencodePrompt({ surface, query }) {
  const index = surface.skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  return `You are a coding assistant. Your skills (name: description) are listed below. The skill tool loads the full instructions of one skill by name.\n\nYour skills:\n${index}\n\n${tail(query)}\n\nDecide which skills you would load with the skill tool before doing the work. Load a skill only when its instructions would help with this request. Reply with JSON only: {"skill":["name"]} or {"skill":[]}.`;
}

function checkSearches(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.searches)) return { ok: false, error: 'the reply must be a JSON object with a "searches" array' };
  if (v.searches.length > MAX_SEARCHES) return { ok: false, error: `at most ${MAX_SEARCHES} searches` };
  if (!v.searches.every((s) => s && typeof s === 'object' && !Array.isArray(s))) return { ok: false, error: 'each search must be an object' };
  return { ok: true, searches: v.searches };
}

const checkNames = (key) => (v) => (v && Array.isArray(v[key]) && v[key].every((n) => typeof n === 'string')
  ? { ok: true, names: v[key].map((n) => n.trim()).filter(Boolean) }
  : { ok: false, error: `the reply must be a JSON object with a "${key}" array of names` });

const sumCredits = (calls) => calls.reduce((n, c) => n + (c.credits || 0), 0);
const notNamed = (names, capName) => names.filter((n) => n.toLowerCase() !== capName.toLowerCase());
const has = (names, capName) => names.some((n) => n.toLowerCase() === capName.toLowerCase());

async function kiroUnit({ q, rep, surface, caller, model, capName }) {
  const calls = [];
  const row = { queryId: q.id, rep, expect: q.expect, ...(q.nearMissOf ? { nearMissOf: q.nearMissOf } : {}), hit: false, fired: [], candidates: [], retrieved: false, searchErrors: [], invalidPicks: [], failure: null };
  const one = await judgeOnce({ caller, model, prompt: stage1Prompt({ surface, query: q.text }), check: checkSearches });
  calls.push(...one.calls);
  if (one.error) return { row: { ...row, failure: 'error', error: one.error }, calls };
  const seen = new Map();
  for (const s of one.value.searches) {
    const res = findSkills(surface.records, s);
    if (!res.ok) { row.searchErrors.push(res.error); continue; }
    for (const rec of res.records) seen.set(rec.name, rec);
  }
  const candidates = [...seen.values()];
  row.candidates = candidates.map((c) => c.name);
  row.retrieved = has(row.candidates, capName);
  row.searches = one.value.searches;
  if (!candidates.length) {
    row.failure = q.expect === 'load' ? (one.value.searches.length ? 'retrieval' : 'no-search') : null;
    return { row, calls };
  }
  const pick = await judgeOnce({ caller, model, prompt: stage3Prompt({ surface, query: q.text, candidates }), check: checkNames('get_skill') });
  calls.push(...pick.calls);
  if (pick.error) return { row: { ...row, failure: 'error', error: pick.error }, calls };
  const valid = pick.value.names.filter((n) => has(row.candidates, n));
  row.invalidPicks = pick.value.names.filter((n) => !has(row.candidates, n));
  row.hit = has(valid, capName);
  row.fired = notNamed(valid, capName);
  if (q.expect === 'load' && !row.hit) row.failure = row.retrieved ? 'judgment' : 'retrieval';
  if (q.expect === 'none' && row.hit) row.failure = 'false-trigger';
  return { row, calls };
}

async function opencodeUnit({ q, rep, surface, caller, model, capName }) {
  const names = surface.skills.map((s) => s.name);
  const row = { queryId: q.id, rep, expect: q.expect, ...(q.nearMissOf ? { nearMissOf: q.nearMissOf } : {}), hit: false, fired: [], candidates: names, retrieved: true, searchErrors: [], invalidPicks: [], failure: null };
  const out = await judgeOnce({ caller, model, prompt: opencodePrompt({ surface, query: q.text }), check: checkNames('skill') });
  if (out.error) return { row: { ...row, failure: 'error', error: out.error }, calls: out.calls };
  const valid = out.value.names.filter((n) => has(names, n));
  row.invalidPicks = out.value.names.filter((n) => !has(names, n));
  row.hit = has(valid, capName);
  row.fired = notNamed(valid, capName);
  if (q.expect === 'load' && !row.hit) row.failure = 'judgment';
  if (q.expect === 'none' && row.hit) row.failure = 'false-trigger';
  return { row, calls: out.calls };
}

/**
 * Runs the proxy over `queries` (each { id, text, expect, nearMissOf? }) for `reps` repeats. `caller` is the tool-less
 * model call: async ({ model, prompt }) => { text, credits, error? }. Returns { rows, calls, spent, skipped }; rows
 * skipped because the credit budget was reached are listed in `skipped` and are not scored.
 */
async function runProxy({ harness, capName, queries, reps = 1, surface, caller, model, concurrency = 2, budgetCredits = null, log = () => {} }) {
  const unit = harness === 'opencode' ? opencodeUnit : kiroUnit;
  const plan = [];
  for (let rep = 1; rep <= reps; rep++) for (const q of queries) plan.push({ q, rep });
  let spent = 0;
  const calls = [];
  const worker = async ({ q, rep }) => {
    const res = await unit({ q, rep, surface, caller, model, capName });
    const c = sumCredits(res.calls);
    spent += c;
    calls.push(...res.calls.map((x) => ({ queryId: q.id, rep, ...x })));
    res.row.credits = c;
    log(`proxy ${q.id} #${rep}: ${res.row.failure ?? (res.row.hit ? 'fired' : 'quiet')} (spent ${spent.toFixed(3)})`);
    return res.row;
  };
  const results = await runPool(plan, concurrency, worker, () => budgetCredits != null && spent >= budgetCredits, ({ q, rep }) => ({ skipped: true, queryId: q.id, rep }));
  return { rows: results.filter((r) => !r.skipped), skipped: results.filter((r) => r.skipped), calls, spent };
}

/** Failure counts over a proxy run: expect:load misses by cause, false triggers and unusable replies. */
function summarizeProxy(rows) {
  const count = (f) => rows.filter((r) => r.failure === f).length;
  return { retrievalFailures: count('retrieval'), judgmentFailures: count('judgment'), noSearch: count('no-search'), falseTriggers: count('false-trigger'), errors: count('error') };
}

module.exports = { runProxy, summarizeProxy, proxySupported, stage1Prompt, stage3Prompt, opencodePrompt, MAX_SEARCHES };
