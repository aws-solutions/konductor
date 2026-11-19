#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pipeline glue for T7 task authoring. One subcommand per step:
//   prompt <id>    renders the author prompt and readies work/<id>/ (grader files in hidden/; a twin gets its real task's fixture)
//   author <id>    the author model writes the task in work/<id>/
//   fix <id> FILE  the same author gets one fix round in work/<id>/, with the instructions in FILE
//   map <id>       a third model family tags the finished task from skill, SOP and agent descriptions only (catalog.json)
//   review <id>    a model of another family reviews the finished task
//   assemble <id>  writes the task into bench/scenarios/t7/ (task file, fixtures/, hidden/, solutions/, answers/)
// Needs T7_AUTH: a directory with run.sh (usage: run.sh <model> <cwd> <promptfile> <outprefix>; it runs kiro-cli in a scratch
// home with no steering, rules, MCP or skills) and catalog.json (t1/catalog-descriptions.js). Every model call appends its
// credits to AUTHORING-LOG.md. The mapping prompt is T1's (`../t1/prompts/map.md`), so both batches tag the same way.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { streamInfo } = require('../t1/stage.js');

const DIR = __dirname;
const AUTH = process.env.T7_AUTH;
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
const TEST_CMD = 'node --test --test-timeout=15000 hidden/*.test.*';
const GRADER_FILES = ['plan-grade.cjs', 'plan.test.cjs'];
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const brief = (id) => readJson(path.join(DIR, 'briefs', `${id}.json`));
const work = (...p) => path.join(AUTH, 'work', ...p);

function logCall(id, step, model, credits, seconds) {
  fs.appendFileSync(path.join(DIR, 'AUTHORING-LOG.md'), `| ${id} | ${step} | ${model} | ${Math.round(seconds)} | ${credits.toFixed(2)} |\n`);
}

function call(model, cwd, prompt, name) {
  const promptFile = work(`${name}.prompt.txt`);
  fs.writeFileSync(promptFile, prompt);
  fs.mkdirSync(cwd, { recursive: true });
  const t0 = Date.now();
  spawnSync('sh', [path.join(AUTH, 'run.sh'), model, cwd, promptFile, work(name)], { stdio: 'ignore', timeout: 2400000 });
  return { ...streamInfo(work(`${name}.out`)), seconds: (Date.now() - t0) / 1000 };
}

function jsonIn(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

function renderPrompt(id) {
  const b = brief(id);
  const src = typeof b.source === 'object' ? `${b.source.url} (${b.source.licence})` : 'original';
  const expert = b.expert
    ? `   - \`expertKey\`: \`{ "items": [{ "id", "text", "source" }], "weakAnswers": [3 to 5 strings] }\`: 5 to 8 risks, trade-offs or failure modes a strong answer to THIS request must address and that the key's assertions do not already check (judges read it, never the agent). Each item applies a practice from one of these public sources to this task's data, in your own words, and its \`source\` is that source's name and URL exactly as written here: ${b.expertSources.map((x) => `"${x}"`).join('; ')}. \`weakAnswers\` are 3 to 5 things a shallow answer would say.\n`
    : '';
  const twin = b.controlKind === 'twin'
    ? `- This is a near-miss twin of \`${b.twinOf}\`: \`fixture/\` is already here, copied from that task. Do not change it and do not write a new one; skip step 1 and \`authoring/generate.py\`. Write \`authoring/compute_key.py\`, \`hidden/key.json\`, \`solution/\` and \`task-draft.json\`, and set \`dataFile\` to the export file. The request wants plain numbers; it must not ask for a status, risks or a plan.\n`
    : '';
  const fill = { ID: id, PHASE: b.phase, ROLE: b.role, KIND: b.kind, SCENARIO: b.scenario, SEEDS: b.seeds, SOURCE: src, OUTPUT: b.output, BLOCK: b.block, SHAPE: b.shape, EXPERT: expert, TWIN: twin };
  return fs.readFileSync(path.join(DIR, 'prompts', 'author.md'), 'utf8').replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

function prompt(id) {
  const b = brief(id);
  const w = work(id);
  fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'hidden'), { recursive: true });
  for (const f of GRADER_FILES) fs.copyFileSync(path.join(DIR, 'lib', f), path.join(w, 'hidden', f));
  if (b.controlKind === 'twin') fs.cpSync(path.join(DIR, 'fixtures', b.twinOf), path.join(w, 'fixture'), { recursive: true });
  fs.writeFileSync(work(`${id}.prompt.txt`), renderPrompt(id));
  return { id, dir: w };
}

function author(id) {
  const b = brief(id);
  const r = call(b.author, work(id), fs.readFileSync(work(`${id}.prompt.txt`), 'utf8'), `${id}.author`);
  logCall(id, 'author', b.author, r.credits, r.seconds);
  return { credits: r.credits, seconds: r.seconds, draft: fs.existsSync(work(id, 'task-draft.json')) };
}

function fix(id, file) {
  const b = brief(id);
  const text = `${fs.readFileSync(work(`${id}.prompt.txt`), 'utf8')}\n\n## Fix round\n\nYou wrote this task in the current directory earlier. A reviewer and a dry run found the problems below. Fix them in place, keep everything else, and verify again as in step 6.\n\n${fs.readFileSync(file, 'utf8')}`;
  const r = call(b.author, work(id), text, `${id}.fix`);
  logCall(id, 'fix', b.author, r.credits, r.seconds);
  return { credits: r.credits, seconds: r.seconds };
}

function map(id) {
  const draft = readJson(work(id, 'task-draft.json'));
  const catalogList = readJson(path.join(AUTH, 'catalog.json'));
  const catalog = catalogList.map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const task = JSON.stringify({ request: draft.prompt, rubric: draft.rubric, notes: draft.notes }, null, 1);
  const text = fs.readFileSync(path.join(DIR, '..', 't1', 'prompts', 'map.md'), 'utf8').replace('{{TASK}}', () => task).replace('{{CATALOG}}', () => catalog);
  const model = 'glm-5';
  const r = call(model, work(`${id}-map`), text, `${id}.map`);
  logCall(id, 'map', model, r.credits, r.seconds);
  const known = new Set(catalogList.map((c) => `${c.kind}:${c.name}`));
  const out = jsonIn(r.finalText);
  out.targetSkills = (out.targetSkills || []).filter((n) => known.has(`skill:${n}`));
  if (out.targetSop && !known.has(`sop:${out.targetSop}`)) out.targetSop = null;
  if (out.targetAgent && !known.has(`agent:${out.targetAgent}`)) out.targetAgent = null;
  fs.writeFileSync(work(`${id}.map.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

function review(id) {
  const model = brief(id).reviewer;
  const cwd = work(`${id}-review`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.cpSync(work(id), cwd, { recursive: true });
  const r = call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts', 'review.md'), 'utf8'), `${id}.review`);
  logCall(id, 'review', model, r.credits, r.seconds);
  const out = readJson(path.join(cwd, 'review.json'));
  fs.writeFileSync(work(`${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

/** The task file for a brief, its author's draft, key, mapping and review (pure; `assemble` writes it). */
function buildTask(b, draft, key, mapping, rev, date = today()) {
  const twin = b.controlKind === 'twin';
  const real = twin ? null : mapping;
  return {
    id: b.id,
    class: 'design',
    version: b.version || 1,
    phase: b.phase,
    role: b.role,
    questions: 'allowed',
    prompt: draft.prompt,
    fixture: twin ? b.twinOf : b.id,
    hidden: b.id,
    timeoutSec: draft.limits.hardSec,
    limits: draft.limits,
    checks: [
      { type: 'tests', cmd: TEST_CMD, min: key.assertions.length, weight: 3, kind: 'substance' },
      { type: 'file_exists', path: b.output, weight: 3, kind: 'substance' },
      { type: 'fixture_unchanged', path: draft.dataFile, weight: 1, kind: 'substance' },
      { type: 'contains', path: b.output, pattern: `\`\`\`\\s*${b.block}`, weight: 1, kind: 'format' },
    ],
    rubric: draft.rubric,
    ...(draft.expertKey ? { expertKey: draft.expertKey } : {}),
    targetSkills: real ? real.targetSkills : [],
    targetSop: real ? real.targetSop : null,
    targetAgent: real ? real.targetAgent : null,
    controlKind: b.controlKind,
    ...(twin ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: real ? real.targetSkills : [], mustNotLoad: twin ? mapping.targetSkills : [] },
    effectSubset: false,
    tiers: ['full'],
    authorship: { family: FAMILY[b.author], model: b.author, date: b.date || date, source: b.source },
    ...(rev ? { review: { family: FAMILY[rev.model], date, verdicts: rev.verdicts.map((v) => ({ check: v.check, verdict: v.verdict, note: v.note })) } } : {}),
  };
}

function assemble(id) {
  const b = brief(id);
  const w = work(id);
  const draft = readJson(path.join(w, 'task-draft.json'));
  const key = readJson(path.join(w, 'hidden', 'key.json'));
  // A twin carries no targets of its own: its mustNotLoad is the real task's targets.
  const mapFile = work(`${b.controlKind === 'twin' ? b.twinOf : id}.map.json`);
  const mapping = fs.existsSync(mapFile) ? readJson(mapFile) : { targetSkills: [], targetSop: null, targetAgent: null };
  const reviewFile = work(`${id}.review.json`);
  const rev = fs.existsSync(reviewFile) ? readJson(reviewFile) : null;
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(buildTask(b, draft, key, mapping, rev), null, 2)}\n`);
  const put = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
  if (b.controlKind !== 'twin') put(path.join(w, 'fixture'), path.join(DIR, 'fixtures', id));
  fs.mkdirSync(path.join(DIR, 'hidden', id), { recursive: true });
  put(path.join(w, 'hidden'), path.join(DIR, 'hidden', id, 'hidden'));
  // The grader files always come from lib/, so a fix to the grader reaches every task (t7.test.js checks the copies).
  for (const f of GRADER_FILES) fs.copyFileSync(path.join(DIR, 'lib', f), path.join(DIR, 'hidden', id, 'hidden', f));
  put(path.join(w, 'solution'), path.join(DIR, 'solutions', id));
  put(path.join(w, 'authoring'), path.join(DIR, 'authoring', id));
  // Scored answers for the dry run (dry-answers.js): the author's lazy answer and the reviewer's alternative correct one.
  const answers = { lazy: path.join(w, 'lazy'), alt: path.join(work(`${id}-review`), 'alt') };
  for (const [kind, from] of Object.entries(answers)) {
    if (fs.existsSync(from)) put(from, path.join(DIR, 'answers', id, kind));
  }
  return { id, assertions: key.assertions.length };
}

if (require.main === module) {
  const [cmd, id, arg] = process.argv.slice(2);
  if (!AUTH) { console.error('set T7_AUTH'); process.exit(2); }
  const fn = { prompt, author, fix, map, review, assemble }[cmd];
  if (!fn || !id) { console.error('usage: stage.js prompt|author|fix|map|review|assemble <id> [FILE]'); process.exit(2); }
  console.log(JSON.stringify(fn(id, arg), null, 1));
}

module.exports = { renderPrompt, buildTask, TEST_CMD, GRADER_FILES };
