#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Pipeline glue for T1 task authoring. One subcommand per step after the author call:
//   map <id>       a third model family tags the finished task from skill descriptions (catalog.json) only
//   review <id>    a model of another family reviews the finished task
//   fix <id>       one fix round: the author repairs its files from the review's findings
//   answers <id>   a model of a third family writes a lazy and an alternative answer (answers/<id>/lazy, answers/<id>/alt)
//   record <id> <dry.json>  writes the dry-run scores into task.pilot (pilot.dryRun: reference, stub, lazy, alt)
//   recheck <id>   a non-Claude checklist re-review of a hand-edited task, into review.recheck
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

// A call stopped before it reported its credits is logged at its abort limit (15), marked as an estimate.
function logCall(id, step, model, credits, estimated = false) {
  const file = path.join(DIR, 'AUTHORING-LOG.md');
  const note = estimated ? ' (estimate: stopped before it reported; logged at the 15-credit abort limit)' : '';
  fs.appendFileSync(file, `| ${id} | ${step} | ${model} | ${credits.toFixed(2)}${note} |\n`);
}

function call(model, cwd, prompt, name) {
  const promptFile = path.join(AUTH, 'work', `${name}.prompt.txt`);
  fs.writeFileSync(promptFile, prompt);
  fs.mkdirSync(cwd, { recursive: true });
  const prefix = path.join(AUTH, 'work', name);
  spawnSync('sh', [path.join(AUTH, process.env.T1_RUN || 'run.sh'), model, cwd, promptFile, prefix], { stdio: 'ignore', timeout: 1500000 });
  if (fs.existsSync(`${prefix}.refused`)) throw new Error(`spend check refused the ${name} call`);
  const info = streamInfo(`${prefix}.out`);
  const finished = fs.readFileSync(`${prefix}.out`, 'utf8').includes('"runFinished"');
  return finished ? info : { ...info, credits: 15, estimated: true };
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
  const { credits, finalText, estimated } = call(model, path.join(AUTH, 'work', `${id}-map`), prompt, `${id}.map`);
  logCall(id, 'map', model, credits, estimated);
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
  const { credits, estimated } = call(model, cwd, prompt, `${id}.review`);
  logCall(id, 'review', model, credits, estimated);
  const out = readJson(path.join(cwd, 'review.json'));
  fs.writeFileSync(path.join(AUTH, 'work', `${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
  return out;
}

function logAuthor(id, step = 'author', model = brief(id).author) {
  const file = path.join(AUTH, 'work', `${id}.${step}.out`);
  if (!fs.existsSync(file) || fs.existsSync(path.join(AUTH, 'work', `${id}.${step}.refused`))) return { credits: 0, refused: true };
  const finished = fs.readFileSync(file, 'utf8').includes('"runFinished"');
  const credits = finished ? streamInfo(file).credits : 15;
  logCall(id, step, model, credits, !finished);
  return { credits };
}

function fix(id) {
  const b = brief(id);
  const rev = readJson(path.join(AUTH, 'work', `${id}.review.json`));
  const fails = rev.verdicts.filter((v) => v.verdict === 'fail').map((v) => `- ${v.check}: ${v.note}`);
  // The free dry run's findings, when it ran: which checks failed on the reference and how the hidden suite ended.
  const dryFile = path.join(AUTH, 'work', `${id}.dry.json`);
  const dry = fs.existsSync(dryFile) && fs.statSync(dryFile).size ? readJson(dryFile) : null;
  const dryLines = dry ? dry.reference.checks_.filter((c) => !c.passed).map((c) => `- dry run, reference: ${c.type} check failed (${c.detail})`) : [];
  if (dry && dry.stub.score > 20) dryLines.push(`- dry run: the untouched fixture scores ${dry.stub.score.toFixed(1)} (must be 20 or less)`);
  // Facts the pipeline found that neither the review nor the dry run could report (for example a check list the scorer cannot read).
  const notesFile = path.join(AUTH, 'work', `${id}.fixnotes`);
  if (fs.existsSync(notesFile)) dryLines.push(...fs.readFileSync(notesFile, 'utf8').split('\n').filter(Boolean).map((l) => `- ${l}`));
  const problems = [...dryLines, ...fails, ...(rev.reference?.failingChecks || []).map((c) => `- reference run: ${c}`), ...(rev.fixes || []).map((f) => `- suggested fix: ${f}`)].join('\n');
  const w = path.join(AUTH, 'work', id);
  fs.rmSync(`${w}.v1`, { recursive: true, force: true });
  fs.cpSync(w, `${w}.v1`, { recursive: true });
  const extra = `\n\n## Fix round\n\nThe files you wrote are in the current directory. A reviewer ran them and found these problems:\n\n${problems}\n\nFix them in place and delete any stray or abandoned files (a solution overlay must contain only files that belong in the finished change; hidden tests must find the code they import without help from the environment, for example by adding the source folder to sys.path or requiring it by relative path). Then verify again from a scratch folder: existing tests pass on fixture plus solution, every hidden test and every check passes on fixture plus solution, and at most 20% of hidden tests pass on the plain fixture. Finish within about 30 tool calls. Keep the same task id and the same file layout.`;
  const prompt = require('./render-prompt.js').render(id) + extra;
  const { credits, estimated } = call(b.author, w, prompt, `${id}.fix`);
  logCall(id, 'fix', b.author, credits, estimated);
  return { credits };
}

// An author guesses its own time; a developer task gets at least 600 s soft and twice that hard (limits are re-set after the pilot).
const limitsOf = (l) => { const softSec = Math.max(l.softSec, 600); return { softSec, hardSec: Math.max(l.hardSec, softSec * 2) }; };

// The answer writer is never the author's family: a gpt-written task gets glm-5 (qwen3-coder-next wrote lazy answers as complete as its alternatives), any other gets gpt-5.6-luna.
const answerModel = (author) => (author === 'gpt-5.6-luna' ? 'glm-5' : 'gpt-5.6-luna');

function answers(id) {
  const task = readJson(path.join(DIR, `${id}.json`));
  const model = answerModel(task.authorship.model);
  const cwd = path.join(AUTH, 'work', `${id}-answers`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.cpSync(path.join(DIR, 'fixtures', task.fixture || id), path.join(cwd, 'repo'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'request.md'), `${task.prompt}\n`);
  const { credits, estimated } = call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts', 'answers.md'), 'utf8'), `${id}.answers`);
  logCall(id, 'lazy+alt answers', model, credits, estimated);
  for (const kind of ['lazy', 'alt']) {
    const from = path.join(cwd, kind);
    const to = path.join(DIR, 'answers', id, kind);
    fs.rmSync(to, { recursive: true, force: true });
    if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
  }
  return { model, credits };
}

function recheck(id) {
  const file = path.join(DIR, `${id}.json`);
  const task = readJson(file);
  const model = 'glm-5';
  const cwd = path.join(AUTH, 'work', `${id}-recheck`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.mkdirSync(cwd, { recursive: true });
  fs.cpSync(path.join(DIR, 'fixtures', task.fixture || id), path.join(cwd, 'fixture'), { recursive: true });
  fs.cpSync(path.join(DIR, 'hidden', id, 'hidden'), path.join(cwd, 'hidden'), { recursive: true });
  fs.cpSync(path.join(DIR, 'solutions', id), path.join(cwd, 'solution'), { recursive: true });
  const { review, pilot, handEdited, ...shown } = task;
  fs.writeFileSync(path.join(cwd, 'task.json'), `${JSON.stringify(shown, null, 2)}\n`);
  const rows = fs.readFileSync(path.join(DIR, 'HAND-EDITS.md'), 'utf8').split('\n').filter((l) => l.startsWith(`| ${id} |`));
  fs.writeFileSync(path.join(cwd, 'edits.md'), `${rows.join('\n')}\n`);
  const { credits, estimated } = call(model, cwd, fs.readFileSync(path.join(DIR, 'prompts', 'recheck.md'), 'utf8'), `${id}.recheck`);
  logCall(id, 'recheck', model, credits, estimated);
  const out = readJson(path.join(cwd, 'recheck.json'));
  task.review.recheck = { family: FAMILY[model], model, date: today(), items: out.items.map((i) => ({ check: i.check, verdict: i.verdict, note: i.note })) };
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  return task.review.recheck;
}

function record(id, dryFile) {
  const d = readJson(dryFile);
  const file = path.join(DIR, `${id}.json`);
  const task = readJson(file);
  const r = (m) => (m ? Math.round(m.score * 10) / 10 : null);
  const date = today();
  // The lazy figure is the higher of the model-written lazy answer and the free shallow answer, so neither can hide.
  const lazy = Math.max(r(d.lazy) ?? 0, r(d.shallow) ?? 0);
  const alt = r(d.alt);
  const gates = d.pass && lazy <= 40 && alt !== null && alt >= 80;
  task.pilot = { scores: {}, reference: r(d.reference), stub: r(d.stub), decision: gates ? 'keep' : 'fix', date, dryRun: { reference: r(d.reference), stub: r(d.stub), lazy, alt: alt ?? 0, date } };
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  return task.pilot;
}

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
    fixture: b.onFixture || b.id,
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
  if (!b.onFixture) put(path.join(w, 'fixture'), path.join(DIR, 'fixtures', id));
  fs.mkdirSync(path.join(DIR, 'hidden', id), { recursive: true });
  put(path.join(w, 'hidden'), path.join(DIR, 'hidden', id, 'hidden'));
  put(path.join(w, 'solution'), path.join(DIR, 'solutions', id));
}

if (require.main === module) {
  const [cmd, id, extra] = process.argv.slice(2);
  if (!AUTH) { console.error('set T1_AUTH'); process.exit(2); }
  const fn = { map, review, assemble, fix, answers, record, recheck, 'log-author': (id, step) => logAuthor(id, step) }[cmd];
  if (!fn || !id) { console.error('usage: stage.js map|review|assemble|log-author <id>'); process.exit(2); }
  const r = fn(id, extra);
  if (r) console.log(JSON.stringify(r, null, 1));
}

module.exports = { map, review, assemble, fix, answers, record, recheck, streamInfo };
