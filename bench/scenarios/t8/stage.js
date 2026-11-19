#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pipeline glue for T8 task authoring, after the author call. Subcommands (all take a task id):
//   audit <id>      blindness audit of every stream of the task (author, map, review): reads of a konductor skills/,
//                   agent-sops/, agents/ or context/ path, or of another batch's scratch dir; exits 1 on a unit read
//   log-author <id> logs the author call's credits
//   normalize <id>  moves stray author files into work/<id>/fixture/ and builds hidden/ from the draft (lib/selfcheck.js)
//   map <id>        glm-5 tags the finished task from skill, SOP and agent names and descriptions only (work/<id>.map.json)
//   review <id>     a model of another family reviews the finished task (work/<id>.review.json)
//   assemble <id>   writes the task into bench/scenarios/t8/ (task file, fixtures/, hidden/, solutions/, authoring/<id>/gen)
// Needs T8_AUTH: a directory with run.sh (run.sh <model> <cwd> <promptfile> <outprefix>), work/<id>/ (the author's
// output) and catalog.json (names and descriptions, ../t1/catalog-descriptions.js). Every model call is logged with its credits.
// shortcut: map, review and assemble follow T5's stage.js with T8's kinds; fold the batch stage tools into one module (DEBT row).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { streamInfo } = require('../t1/stage.js');
const { buildHidden } = require('./lib/selfcheck.js');

const DIR = __dirname;
const AUTH = process.env.T8_AUTH;
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
const AUTHOR_FILES = new Set(['hidden', 'solution', 'kit', 'gen', 'task-draft.json', 'review.json', 'fixture']);
const SOP_NEEDS_YES = new Set(['k-e2e-test-generation', 'k-light-ui-testing', 'k-test-coverage-review']);
const YES_SENTENCE = 'Yes, that scope is confirmed, and committing the work on the branch I am on is fine.';
const UNIT_READ = /\/(skills|agent-sops|agents|context)\//;
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const brief = (id) => readJson(path.join(DIR, 'briefs', `${id}.json`));
const work = (...p) => path.join(AUTH, 'work', ...p);

const logCall = (id, step, model, credits, note = '') => fs.appendFileSync(path.join(DIR, 'AUTHORING-LOG.md'), `| ${id} | ${step} | ${model} | ${credits.toFixed(2)} | ${note} |\n`);

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

// Absolute paths named in tool calls of one stream that fall outside the authoring dir, classified.
function auditStream(file) {
  const paths = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('tool_call')) continue;
    for (const m of line.matchAll(/\/(?:home|local|var|tmp|opt|root)\/[A-Za-z0-9_.\/-]+/g)) paths.add(m[0]);
  }
  const roots = [AUTH, fs.realpathSync(AUTH)];
  const outside = [...paths].filter((p) => !roots.some((r) => p.startsWith(`${r}/`)) || roots.some((r) => p.startsWith(`${r}/home/.kiro`)));
  // Another batch's scratch: a sibling of the authoring dir (the batch worktree beside it is this batch's own).
  const parents = roots.map((r) => path.dirname(r));
  const own = roots.map((r) => r.replace(/auth$/, ''));
  return {
    unitReads: outside.filter((p) => UNIT_READ.test(p)),
    otherBatch: outside.filter((p) => parents.some((d) => p.startsWith(`${d}/`)) && !own.some((o) => p === o || p.startsWith(`${o}/`))),
    outside: outside.slice(0, 30),
  };
}

function audit(id) {
  const streams = fs.readdirSync(work()).filter((n) => n.startsWith(`${id}.`) && n.endsWith('.out'));
  const out = Object.fromEntries(streams.map((n) => [n, auditStream(work(n))]));
  fs.writeFileSync(work(`${id}.audit.json`), `${JSON.stringify(out, null, 2)}\n`);
  if (Object.values(out).some((r) => r.unitReads.length)) process.exitCode = 1;
  return out;
}

function logAuthor(id) {
  const model = brief(id).author;
  const { credits } = streamInfo(work(`${id}.author.out`));
  logCall(id, 'author', model, credits);
  return { model, credits };
}

function normalize(id) {
  const w = work(id);
  if (!fs.existsSync(path.join(w, 'fixture'))) fs.mkdirSync(path.join(w, 'fixture'));
  for (const name of fs.readdirSync(w).filter((n) => !AUTHOR_FILES.has(n))) fs.renameSync(path.join(w, name), path.join(w, 'fixture', name));
  buildHidden(w, readJson(path.join(w, 'task-draft.json')));
}

function map(id) {
  const draft = readJson(work(id, 'task-draft.json'));
  const entries = readJson(path.join(AUTH, 'catalog.json'));
  const catalog = entries.map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const task = JSON.stringify({ request: draft.prompt, checks: draft.checks, rubric: draft.rubric, notes: draft.notes }, null, 1);
  const prompt = fs.readFileSync(path.join(DIR, '../t1/prompts/map.md'), 'utf8').replace('{{TASK}}', () => task).replace('{{CATALOG}}', () => catalog);
  const { credits, finalText } = call('glm-5', work(`${id}-map`), prompt, `${id}.map`);
  logCall(id, 'map', 'glm-5', credits);
  const known = new Set(entries.map((c) => `${c.kind}:${c.name}`));
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
  fs.cpSync(work(id), cwd, { recursive: true });
  fs.rmSync(path.join(cwd, 'gen'), { recursive: true, force: true });
  const { credits, finalText } = call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts/review.md'), 'utf8'), `${id}.review`);
  logCall(id, 'review', model, credits);
  // Some reviewers print the verdicts instead of writing review.json; read them from the final reply then.
  const file = path.join(cwd, 'review.json');
  const out = fs.existsSync(file) ? readJson(file) : jsonIn(finalText);
  fs.writeFileSync(work(`${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

// A reviewer's verdict, with the worker's disposition for a failed check ({ check: { verdict, note } }).
function reviewed(v, disposition) {
  const d = disposition[v.check];
  if (v.verdict !== 'fail' || !d) return { check: v.check, verdict: v.verdict, note: v.note };
  return { check: v.check, verdict: d.verdict, note: `${d.note} (reviewer: ${v.note})` };
}

// Owner rule: a decision, NFR or rollout-plan task carries an expert key for the judges; its rubric item scores the
// share of items addressed (the judge share stays at 30% or less).
function withExpertRubric(rubric, key) {
  if (!key) return rubric;
  const item = { id: 'expert-key', weight: 3, criterion: 'Score the share of expertKey items the document addresses; an item counts only when the judge quotes the passage that addresses it, and the weak answers earn nothing. Do not reward length or formatting. (code cannot check this because the items are engineering judgment, not a pattern in the text)' };
  return [...(rubric || []).filter((r) => r.id !== 'expert-key'), item];
}

function mustNotLoad(b, mapping) {
  if (!b.twinOf) return b.mustNotLoad || [];
  const src = readJson(path.join(DIR, `${b.twinOf}.json`));
  return [...src.targetSkills, ...(src.targetSop ? [src.targetSop] : [])].filter((n) => !mapping.targetSkills.includes(n));
}

function assemble(id) {
  const w = work(id);
  const b = brief(id);
  const draft = readJson(path.join(w, 'task-draft.json'));
  const exists = (f) => fs.existsSync(work(f));
  const disposition = exists(`${id}.disposition.json`) ? readJson(work(`${id}.disposition.json`)) : {};
  const mapped = exists(`${id}.map.json`) ? readJson(work(`${id}.map.json`)) : { targetSkills: [], targetSop: null, targetAgent: null };
  // A negative control has no target by definition: what the mapper proposed becomes the loads that must not happen.
  const negative = b.controlKind === 'negative';
  const mapping = negative ? { targetSkills: [], targetSop: null, targetAgent: null } : mapped;
  if (negative) b.mustNotLoad = [...mapped.targetSkills, ...(mapped.targetSop ? [mapped.targetSop] : [])];
  const rev = exists(`${id}.review.json`) ? readJson(work(`${id}.review.json`)) : null;
  // Authors guess seconds of work; an agent needs minutes to read a folder of logs. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(YES_SENTENCE) ? `${draft.prompt} ${YES_SENTENCE}` : draft.prompt;
  const task = {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: withExpertRubric(draft.rubric, b.expertKey),
    ...(b.expertKey ? { expertKey: b.expertKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: FAMILY[b.author], model: b.author, date: b.date || today(), source: b.source },
    ...(rev ? { review: { family: FAMILY[rev.model], date: today(), verdicts: rev.verdicts.map((v) => reviewed(v, disposition)) } } : {}),
    pilot: null, lockedAt: null,
  };
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  const put = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };
  put(path.join(w, 'fixture'), path.join(DIR, 'fixtures', id));
  put(path.join(w, 'hidden'), path.join(DIR, 'hidden', id));
  put(path.join(w, 'solution'), path.join(DIR, 'solutions', id));
  put(path.join(w, 'gen'), path.join(DIR, 'authoring', id, 'gen'));
}

if (require.main === module) {
  const [cmd, id] = process.argv.slice(2);
  if (!AUTH) { console.error('set T8_AUTH'); process.exit(2); }
  const fn = { audit, 'log-author': logAuthor, normalize, map, review, assemble }[cmd];
  if (!fn || !id) { console.error('usage: stage.js audit|log-author|normalize|map|review|assemble <id>'); process.exit(2); }
  const r = fn(id);
  if (r) console.log(JSON.stringify(r, null, 1));
}

module.exports = { audit, auditStream, normalize, map, review, assemble };
