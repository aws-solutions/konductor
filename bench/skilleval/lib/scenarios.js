// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { jaccard, writeJson, REQUEST_SIDE_EFFECT } = require('./util.js');
const { stoplistHits } = require('./skill.js');

const DEFAULT_MAX = 20;
const TYPES = ['rule', 'blind', 'near-miss'];
const DUPLICATE_SIMILARITY = 0.6;
const MIN_PROMPT_CHARS = 30;
const MAX_PROMPT_CHARS = 1500;
const RULES_PER_CALL = 5;
// Prompts must not name konductor procedures (same rule as bench/tasks/validate-tasks.js).
const PROMPT_BANNED = /\bk-[a-z-]+\b|\bSOP\b|konductor|kiro-spec-workflow/i;

/** How many scenarios of each type for a cap: half rule scenarios, 30 percent skill-blind, the rest near-miss (20 gives 10, 6, 4). */
function quotas(max) {
  const rule = Math.round(max * 0.5);
  const blind = Math.round(max * 0.3);
  return { rule, blind, 'near-miss': Math.max(0, max - rule - blind) };
}

const COMMON_RULES = `Each request must:
- read like an ordinary message from a user to an assistant, in the user's own words, 2 to 8 sentences;
- carry every detail the answer needs inside the message (paste short code, numbers or a small table when it helps), so the assistant needs no files or tools;
- be answerable in a written reply only, with no request to save, create, run, commit or install anything;
- never mention a rule, a checklist, a skill, a framework or a named procedure.`;

function rulePrompt({ rules, count, domain }) {
  return `You write realistic test requests for an AI assistant in the domain: ${domain}.

For each rule below, write one request where a good answer would visibly follow the rule, without the request stating or hinting at the rule. A different assistant that does not know the rule should still produce a normal answer, only a weaker one.

${COMMON_RULES}

RULES:
${rules.map((r) => `${r.id}: ${r.text} (kind of request: ${r.requestType})`).join('\n')}

Write ${count} request${count === 1 ? '' : 's'} (one per rule, in order). Reply with only this JSON:
{"scenarios":[{"ruleId":"<rule id>","title":"<4 to 8 word title>","prompt":"<the user's message>"}]}`;
}

function blindPrompt({ description, count, domain }) {
  return `You write realistic test requests for an AI assistant. A tool exists with this one-line description:

"${description}"

Domain: ${domain}.

Write ${count} different requests that a user in this domain might send where that tool would plausibly help. Vary the situation, the size of the task and the wording. Do not copy phrases from the description.

${COMMON_RULES}

Reply with only this JSON:
{"scenarios":[{"title":"<4 to 8 word title>","prompt":"<the user's message>"}]}`;
}

function nearMissPrompt({ description, count, domain }) {
  return `You write realistic test requests for an AI assistant. A tool exists with this one-line description:

"${description}"

Domain: ${domain}.

Write ${count} different requests that look related to that tool's subject at first sight, but where the tool should NOT be used because the user wants something else (a quick factual question, a different kind of task, a small change, an explanation, a task in a neighbouring area). Each must still be a request an assistant can fully answer in writing.

${COMMON_RULES}

Reply with only this JSON:
{"scenarios":[{"title":"<4 to 8 word title>","prompt":"<the user's message>"}]}`;
}

/** Checks one scenario against the stoplist and the shape rules; returns the reasons it fails (empty when it passes). */
function validateScenario(s, { stoplist, skill }) {
  const reasons = [];
  const prompt = String(s.prompt ?? '');
  if (prompt.length < MIN_PROMPT_CHARS) reasons.push('prompt too short');
  if (prompt.length > MAX_PROMPT_CHARS) reasons.push('prompt too long');
  if (!String(s.title ?? '').trim()) reasons.push('no title');
  const hits = stoplistHits(`${s.title ?? ''}\n${prompt}`, stoplist);
  if (hits.length) reasons.push(`skill vocabulary: ${hits.slice(0, 4).join(', ')}`);
  if (prompt.toLowerCase().includes(skill)) reasons.push('names the skill');
  if (REQUEST_SIDE_EFFECT.test(prompt)) reasons.push('asks for a side effect');
  if (PROMPT_BANNED.test(prompt)) reasons.push('names a konductor procedure');
  return reasons;
}

/** The earlier scenario that `s` repeats (same title, or prompts that share most of their words), if any. */
function findDuplicate(s, earlier) {
  return earlier.find((k) => k.title.trim().toLowerCase() === s.title.trim().toLowerCase() || jaccard(k.prompt, s.prompt) >= DUPLICATE_SIMILARITY);
}

const shortList = (arr, n) => arr.slice(0, n);

// A layout rule cannot carry a scenario: its rubric item is a format item and a rule scenario needs value items.
function pickRules(survivors, n) {
  const order = survivors.filter((r) => r.bucket !== 'format').sort((a, b) => (a.tag === 'useful' ? 0 : 1) - (b.tag === 'useful' ? 0 : 1));
  return shortList(order, n).sort((a, b) => a.id.localeCompare(b.id));
}

async function generateType({ type, ask, model, count, survivors, description, domain }) {
  if (count <= 0) return [];
  const check = (v) => { if (!Array.isArray(v?.scenarios)) throw new Error('reply has no scenarios array'); };
  if (type === 'rule') {
    const rules = pickRules(survivors, count);
    const out = [];
    for (let i = 0; i < rules.length; i += RULES_PER_CALL) {
      const chunk = rules.slice(i, i + RULES_PER_CALL);
      const v = await ask.askJson(model, rulePrompt({ rules: chunk, count: chunk.length, domain }), check);
      for (const s of v.scenarios) if (chunk.some((r) => r.id === s.ruleId)) out.push({ type, ruleIds: [s.ruleId], title: s.title, prompt: s.prompt });
    }
    return out;
  }
  const build = type === 'blind' ? blindPrompt : nearMissPrompt;
  const v = await ask.askJson(model, build({ description, count, domain }), check);
  return v.scenarios.map((s) => ({ type, ruleIds: [], title: s.title, prompt: s.prompt }));
}

/**
 * Generates up to `max` scenarios, validates them, and returns the accepted and rejected lists. One repair round asks again for
 * the shortfall of each type; fewer scenarios than the cap is a normal outcome.
 */
async function runScenarios({ skill, survivors, ask, model, max = DEFAULT_MAX, stoplist, domain, outDir, repairRounds = 1 }) {
  const quota = quotas(max);
  const accepted = [];
  const rejected = [];
  const counter = { rule: 0, blind: 0, 'near-miss': 0 };
  const have = (type) => accepted.filter((s) => s.type === type).length;
  const idFor = (type) => `${type === 'near-miss' ? 'n' : type[0]}${String(++counter[type]).padStart(2, '0')}`;

  for (let round = 0; round <= repairRounds; round++) {
    for (const type of TYPES) {
      const need = quota[type] - have(type);
      if (need <= 0) continue;
      const covered = new Set(accepted.filter((s) => s.type === 'rule').flatMap((s) => s.ruleIds));
      const pool = type === 'rule' ? survivors.filter((r) => !covered.has(r.id)) : survivors;
      if (type === 'rule' && !pool.some((r) => r.bucket !== 'format')) continue;
      const made = await generateType({ type, ask, model, count: need, survivors: pool, description: skill.description, domain });
      for (const s of made) {
        const scenario = { type: s.type, ruleIds: s.ruleIds, title: String(s.title ?? '').trim(), prompt: String(s.prompt ?? '').trim() };
        const reasons = validateScenario(scenario, { stoplist, skill: skill.skill });
        const dup = findDuplicate(scenario, accepted);
        if (dup) reasons.push(`duplicates ${dup.id}`);
        if (reasons.length) rejected.push({ ...scenario, round, reasons });
        else if (have(type) < quota[type]) accepted.push({ id: idFor(type), ...scenario });
      }
    }
    if (TYPES.every((t) => have(t) >= quota[t])) break;
  }
  const doc = { skill: skill.skill, model, max, quota, domain, count: accepted.length, scenarios: accepted, rejected };
  if (outDir) writeJson(path.join(outDir, 'scenarios.json'), doc);
  return doc;
}

module.exports = { runScenarios, validateScenario, findDuplicate, quotas, rulePrompt, blindPrompt, nearMissPrompt, DEFAULT_MAX, PROMPT_BANNED };
