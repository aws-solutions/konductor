#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pipeline glue for T5 task authoring, after the author call. Subcommands (all take a task id):
//   normalize <id>  puts the author's repository into work/<id>/fixture/ (the author may have written it at the top) and adds the scoring kit to hidden/
//   map <id>        a third model family tags the finished task from skill descriptions only (work/<id>.map.json)
//   review <id>     a model of another family reviews the finished task (work/<id>.review.json)
//   assemble <id>   writes the task into bench/scenarios/t5/ (task file, fixtures/, hidden/, solutions/)
// Needs T5_AUTH: a directory with run.sh (run.sh <model> <cwd> <promptfile> <outprefix>), work/<id>/ (the author's output) and
// catalog.json (../t1/catalog-descriptions.js). Every model call appends its credits to AUTHORING-LOG.md.
// shortcut: map and review calls repeat T1's stage.js with T5's paths; fold both into one parameterised module when a third batch needs them.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { streamInfo } = require('../t1/stage.js');
const { main: buildHidden } = require('./lib/build-hidden.js');

const DIR = __dirname;
const AUTH = process.env.T5_AUTH;
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
const AUTHOR_FILES = new Set(['hidden', 'solution', 'kit', 'task-draft.json', 'review.json', 'fixture']);
// Owner rule (PR 299): these SOPs need the user's own yes for the scope and for committing, so a task that targets one says so in the user's words.
const SOP_NEEDS_YES = new Set(['k-e2e-test-generation', 'k-light-ui-testing', 'k-test-coverage-review']);
const YES_SENTENCE = 'Yes, that scope is confirmed, and committing the work on the branch I am on is fine.';
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const brief = (id) => readJson(path.join(DIR, 'briefs', `${id}.json`));
const work = (...p) => path.join(AUTH, 'work', ...p);

const logCall = (id, step, model, credits) => fs.appendFileSync(path.join(DIR, 'AUTHORING-LOG.md'), `| ${id} | ${step} | ${model} | ${credits.toFixed(2)} | |\n`);

function call(model, cwd, prompt, name) {
  fs.writeFileSync(work(`${name}.prompt.txt`), prompt);
  fs.mkdirSync(cwd, { recursive: true });
  spawnSync('sh', [path.join(AUTH, 'run.sh'), model, cwd, work(`${name}.prompt.txt`), work(name)], { stdio: 'ignore', timeout: 1500000 });
  return streamInfo(work(`${name}.out`));
}

function jsonIn(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

function normalize(id) {
  const w = work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) {
    fs.mkdirSync(path.join(w, 'fixture'));
    for (const name of fs.readdirSync(w).filter((n) => !AUTHOR_FILES.has(n))) fs.renameSync(path.join(w, name), path.join(w, 'fixture', name));
  }
  const b = brief(id);
  if (b.kind === 'scripted' || b.kind === 'twin') return;
  if (b.kind === 'findings') buildHidden([path.join(w, 'hidden'), 'findings', b.outputFile], readJson(path.join(w, 'task-draft.json')).findingsKey);
  else buildHidden([path.join(w, 'hidden'), 'mutants']);
}

function map(id) {
  const draft = readJson(work(id, 'task-draft.json'));
  const catalog = readJson(path.join(AUTH, 'catalog.json')).map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const task = JSON.stringify({ request: draft.prompt, checks: draft.checks, rubric: draft.rubric, notes: draft.notes }, null, 1);
  const prompt = fs.readFileSync(path.join(DIR, '../t1/prompts/map.md'), 'utf8').replace('{{TASK}}', () => task).replace('{{CATALOG}}', () => catalog);
  const { credits, finalText } = call('glm-5', work(`${id}-map`), prompt, `${id}.map`);
  logCall(id, 'map', 'glm-5', credits);
  const known = new Set(readJson(path.join(AUTH, 'catalog.json')).map((c) => `${c.kind}:${c.name}`));
  const out = jsonIn(finalText);
  out.targetSkills = (out.targetSkills || []).filter((n) => known.has(`skill:${n}`));
  if (out.targetSop && !known.has(`sop:${out.targetSop}`)) out.targetSop = null;
  if (out.targetAgent && !known.has(`agent:${out.targetAgent}`)) out.targetAgent = null;
  fs.writeFileSync(work(`${id}.map.json`), `${JSON.stringify({ model: 'glm-5', ...out }, null, 2)}\n`);
  return out;
}

function review(id) {
  const model = brief(id).reviewer;
  const cwd = work(`${id}-review`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.cpSync(work(id), cwd, { recursive: true});
  const prompt = fs.readFileSync(path.join(DIR, 'prompts/review.md'), 'utf8');
  const { credits } = call(model, cwd, prompt, `${id}.review`);
  logCall(id, 'review', model, credits);
  const out = readJson(path.join(cwd, 'review.json'));
  fs.writeFileSync(work(`${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

// A reviewer's verdict, with the worker's disposition for a failed check ({ check: { verdict, note } }): the reviewer's words stay in the note.
function reviewed(v, disposition) {
  const d = disposition[v.check];
  if (v.verdict !== 'fail' || !d) return { check: v.check, verdict: v.verdict, note: v.note };
  return { check: v.check, verdict: d.verdict, note: `${d.note} (reviewer: ${v.note})` };
}

// Owner rule: a design-type task carries an expert key for the judges; its rubric item scores addressed items over all items (judge share stays at 30% or less).
function withExpertRubric(rubric, key) {
  if (!key) return rubric;
  const item = { id: 'expert-key', weight: 3, criterion: 'Score the share of expertKey items the document addresses; an item counts only when the judge quotes the passage that addresses it, and the weak answers earn nothing. Do not reward length or formatting. (code cannot check this because the items are judgment about test design, not a pattern in the text)' };
  return [...(rubric || []).filter((r) => r.id !== 'expert-key'), item];
}

function assemble(id) {
  const w = work(id);
  const b = brief(id);
  const draft = readJson(path.join(w, 'task-draft.json'));
  const exists = (f) => fs.existsSync(work(f));
  const disposition = exists(`${id}.disposition.json`) ? readJson(work(`${id}.disposition.json`)) : {};
  const mapping = exists(`${id}.map.json`) ? readJson(work(`${id}.map.json`)) : { targetSkills: [], targetSop: null, targetAgent: null };
  const rev = exists(`${id}.review.json`) ? readJson(work(`${id}.review.json`)) : null;
  // Authors guess seconds of work; an agent needs minutes to read a repository and write tests. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(YES_SENTENCE) ? `${draft.prompt} ${YES_SENTENCE}` : draft.prompt;
  const task = {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: withExpertRubric(draft.rubric, b.expertKey),
    ...(draft.findingsKey ? { findingsKey: draft.findingsKey } : {}),
    ...(draft.scriptedUser ? { scriptedUser: draft.scriptedUser } : {}),
    ...(b.expertKey ? { expertKey: b.expertKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: b.mustNotLoad || [] },
    effectSubset: false, tiers: ['full'],
    authorship: { family: FAMILY[b.author], model: b.author, date: b.date || today(), source: b.source },
    ...(rev ? { review: { family: FAMILY[rev.model], date: today(), verdicts: rev.verdicts.map((v) => reviewed(v, disposition)) } } : {}),
    pilot: null, lockedAt: null,
  };
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  const put = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
  put(path.join(w, 'fixture'), path.join(DIR, 'fixtures', id));
  // A twin's hidden tests sit in `hidden/` (the command runs `hidden/*.test.js`), so the hidden dir holds that folder; the other kinds put their files at its top.
  put(path.join(w, 'hidden'), path.join(DIR, 'hidden', id, b.kind === 'twin' ? 'hidden' : ''));
  put(path.join(w, 'solution'), path.join(DIR, 'solutions', id));
}

if (require.main === module) {
  const [cmd, id] = process.argv.slice(2);
  if (!AUTH) { console.error('set T5_AUTH'); process.exit(2); }
  const fn = { normalize, map, review, assemble }[cmd];
  if (!fn || !id) { console.error('usage: stage.js normalize|map|review|assemble <id>'); process.exit(2); }
  const r = fn(id);
  if (r) console.log(JSON.stringify(r, null, 1));
}

module.exports = { normalize, map, review, assemble };
