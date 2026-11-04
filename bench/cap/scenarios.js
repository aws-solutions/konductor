// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap scenarios`: at least 8 candidate task scenarios per skill, written to a review file for a person to turn into
// tasks. A skill study needs enough different tasks that one lucky or unlucky task cannot decide it. Scenarios are
// drafted by one tool-less model call per skill; --dry-run writes the prompt and makes no call. Nothing is written
// into the repository and no task is created here.
//
// --mode trigger drafts a different set: tasks that should make the agent load the skill on its own and near misses that
// should not (see the trigger mode section below).

const fs = require('node:fs');
const path = require('node:path');
const { judgeOnce } = require('../judge/run.js');
const { BANNED, DASHES, wordRe, capabilityText, draftFileName, neighboursFor, queryContentProblem } = require('./draft.js');

const TOOL = 'cap-scenarios/1';
const MIN_SCENARIOS = 8;
const MAX_SCENARIOS = 30;
const PROMPT_MIN = 40;
const PROMPT_MAX = 1500;
const EXPECTS = ['helps', 'neutral'];

/** The scenario count: 8 to 30, default 8. */
function checkCount(v) {
  if (v === undefined) return MIN_SCENARIOS;
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_SCENARIOS) throw new Error(`--n must be an integer from ${MIN_SCENARIOS} to ${MAX_SCENARIOS}: a skill study needs at least ${MIN_SCENARIOS} scenarios`);
  if (n > MAX_SCENARIOS) throw new Error(`--n must be an integer from ${MIN_SCENARIOS} to ${MAX_SCENARIOS}: at most ${MAX_SCENARIOS}`);
  return n;
}

const helpsNeeded = (n) => Math.ceil(n * 0.75);

function buildScenarioPrompt({ cap, n = MIN_SCENARIOS }) {
  const shape = {
    scenarios: [{
      title: 'short title', expect: 'helps or neutral',
      prompt: 'the task as a user would write it',
      fixtureIdea: 'what a small fixture project would contain, including the seeded problem',
      checkIdeas: ['a check that can be run on the result without a model'],
      rubricIdeas: ['what a reviewer should look for in the written output'],
      whyItMatters: 'one sentence: why the skill should or should not change the result',
    }],
  };
  return `You are helping a maintainer measure whether a coding-assistant skill improves results. The skill is named ${cap.name}. Its definition follows between the markers.

=== SKILL ${cap.id} ===
${capabilityText(cap)}
=== END SKILL ===

Write ${n} scenarios as JSON: realistic tasks for a coding assistant working in a small project. At least ${helpsNeeded(n)} must be tasks where following this skill should make the result better (expect "helps"). At least 1 must be an ordinary task where the skill should change nothing (expect "neutral"), so a gain that appears there is not credited to the skill.
Rules:
- Each prompt is a task a user would type, ${PROMPT_MIN} to ${PROMPT_MAX} characters, one paragraph, no markdown. Vary the size, the stack and the wording.
- Never name the skill, its id or its tools, and do not use the words SOP, skill or agent or any name that starts with k-. No em dashes or en dashes.
- The task must be doable and checkable in a few minutes in a tiny project. Each scenario has a fixtureIdea with a concrete seeded problem, at least 1 check idea that a script can run, and a rubric idea for what a reviewer would look for.
- The outcome must depend on what the assistant does, not on facts only the skill file contains.

Reply with JSON only, in this shape:
${JSON.stringify(shape, null, 1)}`;
}

/** Strict check of a model reply; { ok: true, draft } or { ok: false, error } naming the first problem. */
function validateScenarios(d, { capName, n = MIN_SCENARIOS }) {
  const fail = (error) => ({ ok: false, error });
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('the reply must be a JSON object');
  if (!Array.isArray(d.scenarios)) return fail('scenarios must be an array');
  const name = wordRe(capName);
  const seen = new Set();
  for (const [i, x] of d.scenarios.entries()) {
    const at = `scenarios[${i}]`;
    if (!x || typeof x !== 'object') return fail(`${at} must be an object`);
    if (!EXPECTS.includes(x.expect)) return fail(`${at}.expect must be helps or neutral`);
    if (typeof x.title !== 'string' || !x.title.trim()) return fail(`${at}.title must be a non-empty string`);
    if (typeof x.prompt !== 'string' || x.prompt.trim().length < PROMPT_MIN || x.prompt.length > PROMPT_MAX) return fail(`${at}.prompt must be between ${PROMPT_MIN} and ${PROMPT_MAX} characters`);
    if (/\n/.test(x.prompt)) return fail(`${at}.prompt must be one paragraph`);
    if (name.test(x.prompt)) return fail(`${at}.prompt names the capability "${capName}"`);
    if (BANNED.test(x.prompt)) return fail(`${at}.prompt names a konductor procedure or agent`);
    if (DASHES.test(JSON.stringify(x))) return fail(`${at} contains an em or en dash`);
    if (typeof x.fixtureIdea !== 'string' || x.fixtureIdea.trim().length < 10) return fail(`${at}.fixtureIdea must describe a small fixture`);
    if (!Array.isArray(x.checkIdeas) || !x.checkIdeas.length || !x.checkIdeas.every((c) => typeof c === 'string' && c.trim())) return fail(`${at}.checkIdeas needs at least 1 check`);
    if (!Array.isArray(x.rubricIdeas) || !x.rubricIdeas.every((c) => typeof c === 'string')) return fail(`${at}.rubricIdeas must be an array of strings`);
    if (typeof x.whyItMatters !== 'string' || x.whyItMatters.trim().length < 8) return fail(`${at}.whyItMatters must be a sentence`);
    const key = x.prompt.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return fail(`${at}: duplicate prompt`);
    seen.add(key);
  }
  if (d.scenarios.length < n) return fail(`too few scenarios: ${d.scenarios.length}, need at least ${n}`);
  if (d.scenarios.length > n + 4) return fail(`too many scenarios (${d.scenarios.length}), at most ${n + 4}`);
  const helps = d.scenarios.filter((x) => x.expect === 'helps').length;
  if (helps < helpsNeeded(n)) return fail(`at least ${helpsNeeded(n)} scenarios must expect "helps" (${helps} do)`);
  if (d.scenarios.length - helps < 1) return fail('at least 1 scenario must expect "neutral"');
  return { ok: true, draft: d };
}

const pad = (i) => `s${String(i + 1).padStart(2, '0')}`;

const CHECKLIST = [
  'Read each prompt as a user would. Delete any that are unrealistic, name the skill, or whose result depends on facts only the skill file holds.',
  'Make sure the "helps" scenarios really need what the skill adds, and the "neutral" ones really do not.',
  'Turn each approved scenario into a task file with a fixture, hidden tests or checks, and a rubric. Check that a run without the skill does not already score at the ceiling.',
  'Run `cap audit` and the task validator on the new tasks before any run.',
];

function renderMd(d) {
  const L = [`# Draft scenarios for ${d.capId}`, ''];
  L.push(`Status: ${d.status}. Generated by ${d.generatedBy.tool} with ${d.generatedBy.model} at ${d.generatedBy.at}. ${d.scenarios.length} scenarios.`);
  L.push('Nothing here is a task yet and nothing was written into the repository.', '', '## Review checklist', '', ...CHECKLIST.map((c) => `- [ ] ${c}`), '');
  for (const s of d.scenarios) {
    L.push(`## ${s.id} (${s.expect}): ${s.title}`, '', s.prompt, '', `- fixture: ${s.fixtureIdea}`, `- checks: ${s.checkIdeas.join('; ')}`);
    if (s.rubricIdeas.length) L.push(`- rubric: ${s.rubricIdeas.join('; ')}`);
    L.push(`- why: ${s.whyItMatters}`, '');
  }
  return `${L.join('\n')}\n`;
}

/**
 * One tool-less model call per skill (a second only when the first reply fails validation). `caller` is
 * async ({ model, prompt }) => { text, credits, error? }. With dryRun the prompt is written and the caller is never used.
 * Returns { ok, calls, credits, ... }.
 */
async function generateScenarios({ capId, scan, caller, model, n = MIN_SCENARIOS, outDir, dryRun = false, now = new Date() }) {
  const cap = scan.get(capId);
  if (!cap) throw new Error(`unknown capability ${capId}`);
  if (cap.kind !== 'skill') throw new Error(`${capId} is a ${cap.kind}: scenarios are drafted for skills only`);
  const dir = path.join(outDir, 'scenarios');
  const stem = draftFileName(capId);
  const prompt = buildScenarioPrompt({ cap, n });
  fs.mkdirSync(dir, { recursive: true });
  if (dryRun) {
    const file = path.join(dir, `${stem}.prompt.txt`);
    fs.writeFileSync(file, `${prompt}\n`);
    return { ok: true, dryRun: true, calls: 0, credits: 0, file };
  }
  const out = await judgeOnce({ caller, model, prompt, check: (v) => validateScenarios(v, { capName: cap.name, n }) });
  const credits = out.calls.reduce((s, c) => s + (c.credits || 0), 0);
  if (out.error) return { ok: false, error: out.error, calls: out.calls.length, credits };
  const draft = {
    schemaVersion: 1, capId, kind: cap.kind, status: 'draft-unreviewed',
    generatedBy: { tool: TOOL, model, n, at: now.toISOString() },
    scenarios: out.value.draft.scenarios.map((s, i) => ({
      id: pad(i), title: s.title.trim(), expect: s.expect, prompt: s.prompt.trim(), fixtureIdea: s.fixtureIdea.trim(),
      checkIdeas: s.checkIdeas.map((c) => c.trim()), rubricIdeas: s.rubricIdeas.map((c) => c.trim()), whyItMatters: s.whyItMatters.trim(),
    })),
  };
  const file = path.join(dir, `${stem}.json`);
  const mdFile = path.join(dir, `${stem}.md`);
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  fs.writeFileSync(mdFile, renderMd(draft));
  return { ok: true, dryRun: false, calls: out.calls.length, credits, draft, file, mdFile };
}

// ---- trigger mode ----
//
// `cap scenarios --mode trigger`: tasks that should make the agent load the skill on its own, and near misses that share its
// words but belong elsewhere. The method follows skill-creator's trigger eval queries (Description Optimization, step 1):
// 8 to 10 of each, realistic and concrete, the should-trigger ones in varied phrasings that do not name the skill, the
// should-not ones near misses rather than obviously unrelated requests. Each is also a small task with a fixture idea and
// checks, so the reviewed set can become study tasks, and the file carries a `queries` view for `cap trigger --queries`.

const TRIGGER_TOOL = 'cap-scenarios-trigger/1';
const TRIGGER_MIN = 8;
const TRIGGER_MAX = 10;
const TRIGGER_EXPECTS = ['trigger', 'near-miss'];
const SEED_MAX = 20;
const SEED_TEXT_MAX = 400;
const SAME_OPENING_MAX = 2;

/** Scenarios of each kind (should-trigger and near miss): 8 to 10, default 10. */
function checkTriggerCount(v) {
  if (v === undefined) return TRIGGER_MAX;
  const n = Number(v);
  if (!Number.isInteger(n) || n < TRIGGER_MIN || n > TRIGGER_MAX) throw new Error(`--n must be an integer from ${TRIGGER_MIN} to ${TRIGGER_MAX} with --mode trigger: that many should-trigger tasks and that many near misses`);
  return n;
}

/**
 * Seed queries for the trigger prompt, from a skill-creator eval set ([{ query, should_trigger }]) or a `cap draft` /
 * `cap import` file ({ queries: [{ text, expect }] }). They are intents to build on, not tasks; at most 20 are kept.
 */
function parseSeed(data, { capId = null } = {}) {
  let items;
  if (Array.isArray(data)) {
    items = data.map((x, i) => {
      if (!x || typeof x.query !== 'string' || typeof x.should_trigger !== 'boolean') throw new Error(`seed item ${i + 1}: needs a query string and should_trigger true or false`);
      return { text: x.query, shouldTrigger: x.should_trigger };
    });
  } else if (data && Array.isArray(data.queries)) {
    if (capId && data.capId && data.capId !== capId) throw new Error(`the seed file is for ${data.capId}, not ${capId}`);
    items = data.queries.map((x, i) => {
      if (!x || typeof x.text !== 'string' || (x.expect !== 'load' && x.expect !== 'none')) throw new Error(`seed query ${i + 1}: needs text and expect load or none`);
      return { text: x.text, shouldTrigger: x.expect === 'load' };
    });
  } else {
    throw new Error('the seed file must be a skill-creator eval set (an array of { query, should_trigger }) or a cap draft file with a queries array');
  }
  return items
    .map((x) => ({ ...x, text: x.text.replace(/\s+/g, ' ').trim().slice(0, SEED_TEXT_MAX) }))
    .filter((x) => x.text)
    .slice(0, SEED_MAX);
}

function buildTriggerPrompt({ cap, neighbours = [], seeds = [], n = TRIGGER_MAX }) {
  const neigh = neighbours.length ? neighbours.map((x) => `- ${x.id}: ${x.description}`).join('\n') : '(none)';
  const seedText = (want) => seeds.filter((x) => x.shouldTrigger === want).map((x) => `- ${x.text}`).join('\n') || '(none)';
  const shape = {
    scenarios: [{
      title: 'short title', expect: 'trigger or near-miss',
      prompt: 'the task as a user would type it',
      nearMissOf: 'a neighbour id, only for a near-miss that belongs to that neighbour',
      sharedTerms: ['for a near-miss: the words it shares with the skill text'],
      fixtureIdea: 'what a small fixture project would contain',
      checkIdeas: ['a check that can be run on the result without a model'],
      whyItMatters: 'one sentence: why the skill should or should not load for this task',
    }],
  };
  return `You are helping a maintainer test whether a coding assistant loads a skill on its own when a task needs it, and leaves it alone when a task only sounds like it. The skill is named ${cap.name}. Its definition follows between the markers.

=== SKILL ${cap.id} ===
${capabilityText(cap)}
=== END SKILL ===

Its most similar capabilities (by description overlap), which a keyword match could confuse it with:
${neigh}

Seed requests that a person or an earlier draft marked as should-load (build on their intents, do not copy them):
${seedText(true)}

Seed requests marked as should-not-load:
${seedText(false)}

Write ${n} tasks with expect "trigger" and ${n} with expect "near-miss", as JSON.
Rules for every prompt:
- It is something a real user would type to a coding assistant working in a small project: concrete and specific, with detail such as file paths, function or column names, error text, a little backstory about their job or situation. Some are short and casual, some long, some lowercase or with abbreviations or a typo. ${PROMPT_MIN} to ${PROMPT_MAX} characters, one paragraph, no markdown.
- Never name the skill, its id or its tools, and do not use the words SOP, skill or agent or any name that starts with k-. No em dashes or en dashes.
- Each has a fixtureIdea for a tiny project, at least 1 check idea a script can run, and a one-sentence whyItMatters.
Rules for the "trigger" tasks:
- Each clearly needs what this skill provides, even though it never names it. Cover the intent in different phrasings: some formal, some casual, some without the skill's own vocabulary. Include uncommon uses and cases where this skill competes with a similar capability above and should win.
- No more than ${SAME_OPENING_MAX} prompts may start with the same three words.
Rules for the "near-miss" tasks:
- Each shares words or concepts with this skill but actually needs something different: an adjacent domain, ambiguous wording where a naive keyword match would load the skill, or a case where the skill's topic comes up but another approach is right. Do not write obviously unrelated tasks; they test nothing.
- List in sharedTerms the words it shares with the skill text above (each must appear in both the prompt and the skill text).
- At least half belong to one of the similar capabilities above: set nearMissOf to that capability's id.

Reply with JSON only, in this shape:
${JSON.stringify(shape, null, 1)}`;
}

const openingOf = (text) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join(' ');

/** Strict check of a trigger-mode reply; { ok: true, draft } or { ok: false, error } naming the first problem. */
function validateTriggerScenarios(d, { capName, capText, neighbourIds = [], n = TRIGGER_MAX }) {
  const fail = (error) => ({ ok: false, error });
  if (!d || typeof d !== 'object' || Array.isArray(d)) return fail('the reply must be a JSON object');
  if (!Array.isArray(d.scenarios)) return fail('scenarios must be an array');
  const name = wordRe(capName);
  const skillText = String(capText ?? '').toLowerCase();
  const seen = new Set();
  const openings = new Map();
  for (const [i, x] of d.scenarios.entries()) {
    const at = `scenarios[${i}]`;
    if (!x || typeof x !== 'object') return fail(`${at} must be an object`);
    if (!TRIGGER_EXPECTS.includes(x.expect)) return fail(`${at}.expect must be trigger or near-miss`);
    if (typeof x.title !== 'string' || !x.title.trim()) return fail(`${at}.title must be a non-empty string`);
    if (typeof x.prompt !== 'string' || x.prompt.trim().length < PROMPT_MIN || x.prompt.length > PROMPT_MAX) return fail(`${at}.prompt must be between ${PROMPT_MIN} and ${PROMPT_MAX} characters`);
    const bad = queryContentProblem(x.prompt, { capName, name });
    if (bad) return fail(`${at}.prompt: ${bad.replace(/^the text/, 'it')}`);
    if (DASHES.test(JSON.stringify(x))) return fail(`${at} contains an em or en dash`);
    if (typeof x.fixtureIdea !== 'string' || x.fixtureIdea.trim().length < 10) return fail(`${at}.fixtureIdea must describe a small fixture`);
    if (!Array.isArray(x.checkIdeas) || !x.checkIdeas.length || !x.checkIdeas.every((c) => typeof c === 'string' && c.trim())) return fail(`${at}.checkIdeas needs at least 1 check`);
    if (typeof x.whyItMatters !== 'string' || x.whyItMatters.trim().length < 8) return fail(`${at}.whyItMatters must be a sentence`);
    if (x.expect === 'trigger') {
      if (x.nearMissOf !== undefined) return fail(`${at}: nearMissOf only applies to near-miss tasks`);
      const o = openingOf(x.prompt);
      openings.set(o, (openings.get(o) ?? 0) + 1);
      if (openings.get(o) > SAME_OPENING_MAX) return fail(`${at}: more than ${SAME_OPENING_MAX} trigger prompts start with "${o}"; vary the phrasing`);
    } else {
      if (x.nearMissOf !== undefined && !neighbourIds.includes(x.nearMissOf)) return fail(`${at}: nearMissOf "${x.nearMissOf}" is not one of the neighbours (${neighbourIds.join(', ') || 'none'})`);
      if (!Array.isArray(x.sharedTerms) || !x.sharedTerms.length || !x.sharedTerms.every((t) => typeof t === 'string' && t.trim())) return fail(`${at}.sharedTerms must list the words it shares with the skill`);
      const prompt = x.prompt.toLowerCase();
      const missing = x.sharedTerms.find((t) => !prompt.includes(t.trim().toLowerCase()) || !skillText.includes(t.trim().toLowerCase()));
      if (missing) return fail(`${at}: shared term "${missing}" must appear in both the prompt and the skill text`);
    }
    const key = x.prompt.trim().toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return fail(`${at}: duplicate prompt`);
    seen.add(key);
  }
  const trig = d.scenarios.filter((x) => x.expect === 'trigger').length;
  const near = d.scenarios.length - trig;
  for (const [label, count] of [['trigger', trig], ['near-miss', near]]) {
    if (count < n) return fail(`too few ${label} tasks: ${count}, need at least ${n}`);
    if (count > n + 2) return fail(`too many ${label} tasks (${count}), at most ${n + 2}`);
  }
  const owned = d.scenarios.filter((x) => x.expect === 'near-miss' && x.nearMissOf).length;
  if (neighbourIds.length && owned * 2 < near) return fail(`at least half of the ${near} near misses must name the neighbour they belong to in nearMissOf (${owned} do)`);
  return { ok: true, draft: d };
}

const TRIGGER_CHECKLIST = [
  'Read each prompt as a user would. Delete any that are unrealistic or name the skill.',
  'Each "trigger" task must clearly need the skill. Each near miss must clearly belong elsewhere; check the neighbour it names and the shared terms.',
  'Try the reviewed set with `cap trigger --queries FILE` (this file carries a queries view) before turning any into study tasks.',
  'Turn the approved trigger tasks into task files (fixture, checks, rubric) for the skill study. Near misses become trigger checks, not lift tasks.',
  'Run `cap audit` and the task validator on new tasks before any run.',
];

function renderTriggerMd(d) {
  const L = [`# Draft trigger scenarios for ${d.capId}`, ''];
  L.push(`Status: ${d.status}. Generated by ${d.generatedBy.tool} with ${d.generatedBy.model} at ${d.generatedBy.at}. ${d.generatedBy.n} of each kind requested${d.generatedBy.seeds ? `, ${d.generatedBy.seeds} seed queries from ${d.generatedBy.seedFile}` : ''}.`);
  L.push('Nothing here is a task yet and nothing was written into the repository.', '', '## Review checklist', '', ...TRIGGER_CHECKLIST.map((c) => `- [ ] ${c}`), '');
  if (d.neighbours?.length) L.push('Nearest neighbours: ' + d.neighbours.map((x) => `${x.id} (${x.score})`).join(', '), '');
  for (const [title, expect] of [['Should load the skill', 'trigger'], ['Near misses: should not load it', 'near-miss']]) {
    const xs = d.scenarios.filter((x) => x.expect === expect);
    L.push(`## ${title} (${xs.length})`, '');
    for (const x of xs) {
      L.push(`### ${x.id}: ${x.title}${x.nearMissOf ? ` (near miss of ${x.nearMissOf})` : ''}`, '', x.prompt, '', `- fixture: ${x.fixtureIdea}`, `- checks: ${x.checkIdeas.join('; ')}`);
      if (x.sharedTerms?.length) L.push(`- shared terms: ${x.sharedTerms.join(', ')}`);
      L.push(`- why: ${x.whyItMatters}`, '');
    }
  }
  return `${L.join('\n')}\n`;
}

/**
 * One tool-less model call per skill (a second only when the first reply fails validation), through the same caller as
 * `cap scenarios` and `cap draft`. Writes scenarios/<id>.trigger.json and .md, or with dryRun only the prompt.
 */
async function generateTriggerScenarios({ capId, scan, caller, model, n = TRIGGER_MAX, outDir, seeds = [], seedFile = null, dryRun = false, now = new Date() }) {
  const cap = scan.get(capId);
  if (!cap) throw new Error(`unknown capability ${capId}`);
  if (cap.kind !== 'skill') throw new Error(`${capId} is a ${cap.kind}: scenarios are drafted for skills only`);
  const neighbours = neighboursFor(scan, capId, 5);
  const ids = neighbours.map((x) => x.id);
  const dir = path.join(outDir, 'scenarios');
  const stem = `${draftFileName(capId)}.trigger`;
  const prompt = buildTriggerPrompt({ cap, neighbours, seeds, n });
  fs.mkdirSync(dir, { recursive: true });
  if (dryRun) {
    const file = path.join(dir, `${stem}.prompt.txt`);
    fs.writeFileSync(file, `${prompt}\n`);
    return { ok: true, dryRun: true, calls: 0, credits: 0, file };
  }
  const out = await judgeOnce({ caller, model, prompt, check: (v) => validateTriggerScenarios(v, { capName: cap.name, capText: cap.text, neighbourIds: ids, n }) });
  const credits = out.calls.reduce((s, c) => s + (c.credits || 0), 0);
  if (out.error) return { ok: false, error: out.error, calls: out.calls.length, credits };
  let ti = 0;
  let ni = 0;
  const scenarios = out.value.draft.scenarios.map((x) => ({
    id: x.expect === 'trigger' ? `t${String(++ti).padStart(2, '0')}` : `n${String(++ni).padStart(2, '0')}`,
    title: x.title.trim(), expect: x.expect, prompt: x.prompt.trim(), ...(x.nearMissOf ? { nearMissOf: x.nearMissOf } : {}),
    ...(x.expect === 'near-miss' ? { sharedTerms: x.sharedTerms.map((t) => t.trim()) } : {}),
    fixtureIdea: x.fixtureIdea.trim(), checkIdeas: x.checkIdeas.map((c) => c.trim()), whyItMatters: x.whyItMatters.trim(),
  }));
  const draft = {
    schemaVersion: 1, capId, kind: cap.kind, status: 'draft-unreviewed', mode: 'trigger',
    generatedBy: { tool: TRIGGER_TOOL, model, n, at: now.toISOString(), seeds: seeds.length, seedFile: seedFile ? path.basename(seedFile) : null },
    neighbours: neighbours.map(({ id, score }) => ({ id, score })),
    scenarios,
    // The same tasks as trigger queries (trigger is expect load, near-miss is expect none), for `cap trigger --queries`.
    queries: scenarios.map((x) => ({ id: x.id, text: x.prompt, expect: x.expect === 'trigger' ? 'load' : 'none', ...(x.nearMissOf ? { nearMissOf: x.nearMissOf } : {}) })),
  };
  const file = path.join(dir, `${stem}.json`);
  const mdFile = path.join(dir, `${stem}.md`);
  fs.writeFileSync(file, `${JSON.stringify(draft, null, 2)}\n`);
  fs.writeFileSync(mdFile, renderTriggerMd(draft));
  return { ok: true, dryRun: false, calls: out.calls.length, credits, draft, file, mdFile };
}

module.exports = {
  generateScenarios, buildScenarioPrompt, validateScenarios, checkCount, renderMd, MIN_SCENARIOS, MAX_SCENARIOS, TOOL,
  generateTriggerScenarios, buildTriggerPrompt, validateTriggerScenarios, checkTriggerCount, parseSeed, renderTriggerMd, TRIGGER_MIN, TRIGGER_MAX, TRIGGER_TOOL,
};
