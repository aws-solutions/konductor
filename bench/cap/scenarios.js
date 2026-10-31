// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap scenarios`: at least 8 candidate task scenarios per skill, written to a review file for a person to turn into
// tasks. A skill study needs enough different tasks that one lucky or unlucky task cannot decide it. Scenarios are
// drafted by one tool-less model call per skill; --dry-run writes the prompt and makes no call. Nothing is written
// into the repository and no task is created here.

const fs = require('node:fs');
const path = require('node:path');
const { judgeOnce } = require('../judge/run.js');
const { BANNED, DASHES, wordRe, capabilityText, draftFileName } = require('./draft.js');

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

module.exports = { generateScenarios, buildScenarioPrompt, validateScenarios, checkCount, renderMd, MIN_SCENARIOS, MAX_SCENARIOS, TOOL };
