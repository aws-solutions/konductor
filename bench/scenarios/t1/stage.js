#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pipeline glue for T1 task authoring. One subcommand per step after the author call:
//   map <id>       a third model family tags the finished task from skill descriptions (catalog.json) only
//   review <id>    a model of another family reviews the finished task
//   fix <id>       one fix round: the author repairs its files from the review's findings
//   log-author <id>  appends the author call's credits to the log
//   assemble <id>  writes the task into bench/scenarios/t1/ (task file, fixtures/, hidden/, solutions/)
// Needs T1_AUTH: a directory with run.sh (usage: run.sh <model> <cwd> <promptfile> <outprefix>; it runs kiro-cli in a scratch
// home with no steering, rules, MCP or skills), work/<id>/ (the author's output), catalog.json (catalog-descriptions.js)
// and optional work/<id>.map.json, work/<id>.review.json. Every model call appends its credits to AUTHORING-LOG.md.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStream, aggregateStream } = require('../../runner/lib/stream.js');

const DIR = __dirname;
const AUTH = process.env.T1_AUTH;
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const brief = (id) => readJson(path.join(DIR, 'briefs', `${id}.json`));

/** Credits and final text of a kiro-cli stream-json file. */
function streamInfo(file) {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseStream(text);
  const credits = aggregateStream(parsed.events || parsed).credits;
  const fin = text.split('\n').filter((l) => l.includes('"runFinished"')).pop();
  return { credits, finalText: fin ? JSON.parse(fin).data.finalText ?? '' : '' };
}

function logCall(id, step, model, credits) {
  const file = path.join(DIR, 'AUTHORING-LOG.md');
  fs.appendFileSync(file, `| ${id} | ${step} | ${model} | ${credits.toFixed(2)} |\n`);
}

function call(model, cwd, prompt, name) {
  const promptFile = path.join(AUTH, 'work', `${name}.prompt.txt`);
  fs.writeFileSync(promptFile, prompt);
  fs.mkdirSync(cwd, { recursive: true });
  const prefix = path.join(AUTH, 'work', name);
  spawnSync('sh', [path.join(AUTH, 'run.sh'), model, cwd, promptFile, prefix], { stdio: 'ignore', timeout: 1500000 });
  return streamInfo(`${prefix}.out`);
}

function jsonIn(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
  return JSON.parse(m[0]);
}

function map(id) {
  const draft = readJson(path.join(AUTH, 'work', id, 'task-draft.json'));
  const catalog = readJson(path.join(AUTH, 'catalog.json')).map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const task = JSON.stringify({ request: draft.prompt, checks: draft.checks, rubric: draft.rubric, notes: draft.notes }, null, 1);
  const prompt = fs.readFileSync(path.join(DIR, 'prompts', 'map.md'), 'utf8').replace('{{TASK}}', () => task).replace('{{CATALOG}}', () => catalog);
  const model = 'glm-5';
  const { credits, finalText } = call(model, path.join(AUTH, 'work', `${id}-map`), prompt, `${id}.map`);
  logCall(id, 'map', model, credits);
  const known = new Set(readJson(path.join(AUTH, 'catalog.json')).map((c) => `${c.kind}:${c.name}`));
  const out = jsonIn(finalText);
  out.targetSkills = (out.targetSkills || []).filter((n) => known.has(`skill:${n}`));
  if (out.targetSop && !known.has(`sop:${out.targetSop}`)) out.targetSop = null;
  if (out.targetAgent && !known.has(`agent:${out.targetAgent}`)) out.targetAgent = null;
  fs.writeFileSync(path.join(AUTH, 'work', `${id}.map.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

function review(id) {
  const b = brief(id);
  const model = b.reviewer;
  const cwd = path.join(AUTH, 'work', `${id}-review`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.cpSync(path.join(AUTH, 'work', id), cwd, { recursive: true });
  const prompt = fs.readFileSync(path.join(DIR, 'prompts', 'review.md'), 'utf8');
  const { credits } = call(model, cwd, prompt, `${id}.review`);
  logCall(id, 'review', model, credits);
  const out = readJson(path.join(cwd, 'review.json'));
  fs.writeFileSync(path.join(AUTH, 'work', `${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

function logAuthor(id, step = 'author') {
  const { credits } = streamInfo(path.join(AUTH, 'work', `${id}.${step}.out`));
  logCall(id, step, brief(id).author, credits);
  return { credits };
}

function fix(id) {
  const b = brief(id);
  const rev = readJson(path.join(AUTH, 'work', `${id}.review.json`));
  const fails = rev.verdicts.filter((v) => v.verdict === 'fail').map((v) => `- ${v.check}: ${v.note}`);
  const problems = [...fails, ...(rev.reference?.failingChecks || []).map((c) => `- reference run: ${c}`), ...(rev.fixes || []).map((f) => `- suggested fix: ${f}`)].join('\n');
  const w = path.join(AUTH, 'work', id);
  fs.rmSync(`${w}.v1`, { recursive: true, force: true });
  fs.cpSync(w, `${w}.v1`, { recursive: true });
  const extra = `\n\n## Fix round\n\nThe files you wrote are in the current directory. A reviewer ran them and found these problems:\n\n${problems}\n\nFix them in place and delete any stray or abandoned files (a solution overlay must contain only files that belong in the finished change; hidden tests must find the code they import without help from the environment, for example by adding the source folder to sys.path or requiring it by relative path). Then verify again from a scratch folder: existing tests pass on fixture plus solution, every hidden test and every check passes on fixture plus solution, and at most 20% of hidden tests pass on the plain fixture. Finish within about 30 tool calls. Keep the same task id and the same file layout.`;
  const prompt = require('./render-prompt.js').render(id) + extra;
  const { credits } = call(b.author, w, prompt, `${id}.fix`);
  logCall(id, 'fix', b.author, credits);
  return { credits };
}

// An author guesses its own time; a developer task gets at least 600 s soft and twice that hard (limits are re-set after the pilot).
const limitsOf = (l) => { const softSec = Math.max(l.softSec, 600); return { softSec, hardSec: Math.max(l.hardSec, softSec * 2) }; };

const sourceNote = (s) => (s === 'original' ? 'original (author-written; idea only)' : `${s.url} (${s.licence}; idea only, paraphrased)`);

function assemble(id) {
  const w = path.join(AUTH, 'work', id);
  const b = brief(id);
  const draft = readJson(path.join(w, 'task-draft.json'));
  const mapFile = path.join(AUTH, 'work', `${id}.map.json`);
  const reviewFile = path.join(AUTH, 'work', `${id}.review.json`);
  const mapping = fs.existsSync(mapFile) ? readJson(mapFile) : { targetSkills: [], targetSop: null, targetAgent: null };
  const rev = fs.existsSync(reviewFile) ? readJson(reviewFile) : null;
  const task = {
    id: b.id,
    class: 'hard',
    version: 1,
    phase: b.phase,
    role: b.role,
    questions: 'allowed',
    prompt: draft.prompt,
    fixture: b.id,
    hidden: b.id,
    timeoutSec: limitsOf(draft.limits).hardSec,
    limits: limitsOf(draft.limits),
    checks: draft.checks,
    rubric: draft.rubric.map((r) => ({ weight: 1, ...r })),
    targetSkills: mapping.targetSkills,
    targetSop: mapping.targetSop,
    targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none',
    ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    ...(draft.expertKey ? { expertKey: { items: draft.expertKey.items.map((i) => ({ id: i.id, text: i.text, source: i.source || sourceNote(b.source) })), weakAnswers: draft.expertKey.weakAnswers } } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: b.mustNotLoad || [] },
    tiers: ['full'],
    authorship: { family: FAMILY[b.author], model: b.author, date: b.date || today(), source: b.source === 'original' ? 'original' : b.source },
    ...(rev ? { review: { family: FAMILY[rev.model], date: today(), verdicts: rev.verdicts.map((v) => ({ check: v.check, verdict: v.verdict, note: v.note })) } } : {}),
  };
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  const put = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); };
  put(path.join(w, 'fixture'), path.join(DIR, 'fixtures', id));
  fs.mkdirSync(path.join(DIR, 'hidden', id), { recursive: true });
  put(path.join(w, 'hidden'), path.join(DIR, 'hidden', id, 'hidden'));
  put(path.join(w, 'solution'), path.join(DIR, 'solutions', id));
}

if (require.main === module) {
  const [cmd, id] = process.argv.slice(2);
  if (!AUTH) { console.error('set T1_AUTH'); process.exit(2); }
  const fn = { map, review, assemble, fix, 'log-author': logAuthor }[cmd];
  if (!fn || !id) { console.error('usage: stage.js map|review|assemble|log-author <id>'); process.exit(2); }
  const r = fn(id);
  if (r) console.log(JSON.stringify(r, null, 1));
}

module.exports = { map, review, assemble, fix, streamInfo };
