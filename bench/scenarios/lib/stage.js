#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The authoring stage shared by every batch: the glue after the author call. Subcommands (all take a task id):
//   audit <id>       blindness audit of every model stream of the task: reads of a konductor skills/, agent-sops/,
//                    agents/ or context/ path, or of another batch's scratch dir; exits 1 on a unit read
//   log-author <id>  logs the author call's credits
//   map <id>         a third model family tags the finished task from skill, SOP and agent names and descriptions only
//   review <id>      a model of another family reviews the finished task (work/<id>.review.json)
//   assemble <id>    writes the task into the batch (task file from the batch's `stage.buildTask`, then its layout)
// plus the batch's own subcommands (`stage.commands`).
//   node bench/scenarios/lib/stage.js --config bench/scenarios/tN/scenario.config.js <cmd> <id> [arg]
// Needs the batch's authoring dir in $<stage.authEnv> (default T<N>_AUTH): run.sh (run.sh <model> <cwd> <promptfile>
// <outprefix>; it runs kiro-cli in a scratch home with no steering, rules, MCP or skills), work/<id>/ (the author's
// output) and catalog.json (names and descriptions, t1/catalog-descriptions.js). Every model call is logged with its
// credits in the batch's AUTHORING-LOG.md. The free parts (assemble, audit) need no model.
// Stage config fields: authEnv, mapPrompt (default lib/prompts/map.md), mapModel (default glm-5), timeoutMs,
// logRow(id, step, model, r), reviewFile(cwd) , buildTask(s, id), layout(s, id) -> [[from, to]], commands { name(s, id, arg) }.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStream, aggregateStream } = require('../../runner/lib/stream.js');
const { loadConfig } = require('./config.js');

const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
// Owner rule (PR 299): these SOPs need the user's own yes for the scope and for committing, so a task that targets one
// says so in the user's words.
const SOP_NEEDS_YES = new Set(['k-e2e-test-generation', 'k-light-ui-testing', 'k-test-coverage-review']);
const YES_SENTENCE = 'Yes, that scope is confirmed, and committing the work on the branch I am on is fine.';
const UNIT_READ = /\/(skills|agent-sops|agents|context)\//;
// The checks a review records (task.schema.json); a reviewer's extra entries are dropped.
const REVIEW_CHECKS = new Set(['leak', 'ambiguity', 'ceiling', 'floor', 'hidden-answer']);
const NO_MAPPING = Object.freeze({ targetSkills: [], targetSop: null, targetAgent: null });

const today = () => new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Credits and final text of a kiro-cli stream-json file. */
function streamInfo(file) {
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseStream(text);
  const credits = aggregateStream(parsed.events || parsed).credits;
  const fin = text.split('\n').filter((l) => l.includes('"runFinished"')).pop();
  return { credits, finalText: fin ? JSON.parse(fin).data.finalText ?? '' : '' };
}

/** The first {...} in a model reply, parsed. */
function jsonIn(text) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error(`no JSON in reply: ${String(text).slice(0, 200)}`);
  return JSON.parse(m[0]);
}

const put = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true }); };

// A reviewer's verdict, with the worker's disposition for a failed check ({ check: { verdict, note } }): the reviewer's
// words stay in the note.
function reviewed(v, disposition = {}) {
  const d = disposition[v.check];
  if (v.verdict !== 'fail' || !d) return { check: v.check, verdict: v.verdict, note: v.note };
  return { check: v.check, verdict: d.verdict, note: `${d.note} (reviewer: ${v.note})` };
}

// Owner rule: a design-type task carries an expert key for the judges; its rubric item scores addressed items over all
// items (the judge share stays at 30% or less). `why` says why code cannot check it.
function withExpertRubric(rubric, key, why = 'the items are engineering judgment, not a pattern in the text') {
  if (!key) return rubric;
  const item = { id: 'expert-key', weight: 3, criterion: `Score the share of expertKey items the document addresses; an item counts only when the judge quotes the passage that addresses it, and the weak answers earn nothing. Do not reward length or formatting. (code cannot check this because ${why})` };
  return [...(rubric || []).filter((r) => r.id !== 'expert-key'), item];
}

/** The stage bound to one batch: paths, brief, model call and log. */
function stageOf(cfg) {
  const o = cfg.stage || {};
  const authEnv = o.authEnv || `${path.basename(cfg.dir).toUpperCase()}_AUTH`;
  const auth = () => {
    const a = process.env[authEnv];
    if (!a) throw new Error(`set ${authEnv}`);
    return a;
  };
  const s = {
    cfg, dir: cfg.dir, authEnv, auth, FAMILY, today, readJson, put, jsonIn, streamInfo, reviewed, withExpertRubric, SOP_NEEDS_YES, YES_SENTENCE, NO_MAPPING,
    work: (...p) => path.join(auth(), 'work', ...p),
    brief: (id) => readJson(path.join(cfg.dir, 'briefs', `${id}.json`)),
    workJson: (name, fallback = null) => (fs.existsSync(s.work(name)) ? readJson(s.work(name)) : fallback),
    logCall(id, step, model, r) {
      const row = o.logRow ? o.logRow(id, step, model, r) : `| ${id} | ${step} | ${model} | ${r.credits.toFixed(2)} | ${r.note || ''} |`;
      fs.appendFileSync(path.join(cfg.dir, 'AUTHORING-LOG.md'), `${row}\n`);
    },
    call(model, cwd, prompt, name) {
      fs.writeFileSync(s.work(`${name}.prompt.txt`), prompt);
      fs.mkdirSync(cwd, { recursive: true });
      const t0 = Date.now();
      spawnSync('sh', [path.join(auth(), 'run.sh'), model, cwd, s.work(`${name}.prompt.txt`), s.work(name)], { stdio: 'ignore', timeout: o.timeoutMs || 1500000 });
      return { ...streamInfo(s.work(`${name}.out`)), seconds: (Date.now() - t0) / 1000 };
    },
    // A twin must not load what its source task is meant to load (skills and SOP), unless its own mapping needs it.
    mustNotLoad(b, mapping) {
      if (!b.twinOf) return b.mustNotLoad || [];
      const src = readJson(path.join(cfg.dir, `${b.twinOf}.json`));
      return [...(src.targetSkills || []), ...(src.targetSop ? [src.targetSop] : [])].filter((n) => !mapping.targetSkills.includes(n));
    },
  };
  return s;
}

// Absolute paths named in tool calls of one stream that fall outside the authoring dir, classified.
function auditStream(file, authDir) {
  const paths = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('tool_call')) continue;
    for (const m of line.matchAll(/\/(?:home|local|var|tmp|opt|root)\/[A-Za-z0-9_.\/-]+/g)) paths.add(m[0]);
  }
  const roots = [authDir, fs.realpathSync(authDir)];
  const outside = [...paths].filter((p) => !roots.some((r) => p.startsWith(`${r}/`)) || roots.some((r) => p.startsWith(`${r}/home/.kiro`)));
  // Another batch's scratch: a sibling of the authoring dir (the batch worktree beside it is this batch's own).
  const parents = roots.map((r) => path.dirname(r));
  const own = roots.map((r) => r.replace(/auth$/, ''));
  return {
    unitReads: outside.filter((p) => UNIT_READ.test(p)),
    otherBatch: outside.filter((p) => parents.some((d) => p.startsWith(`${d}/`)) && !own.some((x) => p === x || p.startsWith(`${x}/`))),
    outside: outside.slice(0, 30),
  };
}

const COMMANDS = {
  audit(s, id) {
    const streams = fs.readdirSync(s.work()).filter((n) => n.startsWith(`${id}.`) && n.endsWith('.out'));
    const out = Object.fromEntries(streams.map((n) => [n, auditStream(s.work(n), s.auth())]));
    fs.writeFileSync(s.work(`${id}.audit.json`), `${JSON.stringify(out, null, 2)}\n`);
    if (Object.values(out).some((r) => r.unitReads.length)) process.exitCode = 1;
    return out;
  },
  'log-author'(s, id, step = 'author') {
    const model = s.brief(id).author;
    const { credits } = streamInfo(s.work(`${id}.${step}.out`));
    s.logCall(id, step, model, { credits, seconds: 0 });
    return { model, credits };
  },
  map(s, id) {
    const o = s.cfg.stage || {};
    const draft = readJson(s.work(id, 'task-draft.json'));
    const entries = readJson(path.join(s.auth(), 'catalog.json'));
    const catalog = entries.map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
    const fields = o.mapFields || ['checks', 'rubric', 'notes'];
    const task = JSON.stringify({ request: draft.prompt, ...Object.fromEntries(fields.map((k) => [k, draft[k]])) }, null, 1);
    const tmpl = fs.readFileSync(o.mapPrompt || path.join(__dirname, 'prompts', 'map.md'), 'utf8');
    const prompt = tmpl.replace('{{TASK}}', () => task).replace('{{CATALOG}}', () => catalog);
    const model = o.mapModel || 'glm-5';
    const r = s.call(model, s.work(`${id}-map`), prompt, `${id}.map`);
    s.logCall(id, 'map', model, r);
    const known = new Set(entries.map((c) => `${c.kind}:${c.name}`));
    const out = jsonIn(r.finalText);
    out.targetSkills = (out.targetSkills || []).filter((n) => known.has(`skill:${n}`));
    if (out.targetSop && !known.has(`sop:${out.targetSop}`)) out.targetSop = null;
    if (out.targetAgent && !known.has(`agent:${out.targetAgent}`)) out.targetAgent = null;
    fs.writeFileSync(s.work(`${id}.map.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
    return out;
  },
  review(s, id) {
    const model = s.brief(id).reviewer;
    const cwd = s.work(`${id}-review`);
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.cpSync(s.work(id), cwd, { recursive: true });
    for (const skip of s.cfg.stage?.reviewSkip || []) fs.rmSync(path.join(cwd, skip), { recursive: true, force: true });
    const r = s.call(model, cwd, fs.readFileSync(path.join(s.dir, 'prompts', 'review.md'), 'utf8'), `${id}.review`);
    s.logCall(id, 'review', model, r);
    // Some reviewers print the verdicts instead of writing review.json; read them from the final reply then.
    const file = path.join(cwd, 'review.json');
    const out = fs.existsSync(file) ? readJson(file) : jsonIn(r.finalText);
    if (Array.isArray(out.verdicts)) out.verdicts = out.verdicts.filter((v) => REVIEW_CHECKS.has(v.check));
    fs.writeFileSync(s.work(`${id}.review.json`), `${JSON.stringify({ model, ...out }, null, 2)}\n`);
    return out;
  },
  assemble(s, id) {
    const o = s.cfg.stage || {};
    if (!o.buildTask) throw new Error(`${s.dir}: the batch config has no stage.buildTask`);
    const task = o.buildTask(s, id);
    fs.writeFileSync(path.join(s.dir, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
    const w = s.work(id);
    const layout = o.layout ? o.layout(s, id, task) : [[path.join(w, 'fixture'), path.join(s.dir, 'fixtures', id)], [path.join(w, 'hidden'), path.join(s.dir, 'hidden', id)], [path.join(w, 'solution'), path.join(s.dir, 'solutions', id)]];
    for (const [from, to] of layout) put(from, to);
    return { id };
  },
};

function main(argv) {
  const i = argv.indexOf('--config');
  if (i < 0) { console.error('usage: stage.js --config FILE <cmd> <id> [arg]'); return 2; }
  const cfg = loadConfig(path.resolve(argv[i + 1]));
  const [cmd, id, arg] = argv.filter((_, j) => j !== i && j !== i + 1);
  const all = { ...COMMANDS, ...(cfg.stage?.commands || {}) };
  if (!all[cmd] || !id) { console.error(`usage: stage.js --config FILE ${Object.keys(all).join('|')} <id> [arg]`); return 2; }
  const r = all[cmd](stageOf(cfg), id, arg);
  if (r) console.log(JSON.stringify(r, null, 1));
  return process.exitCode ?? 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { stageOf, COMMANDS, auditStream, streamInfo, jsonIn, reviewed, withExpertRubric, put, FAMILY, SOP_NEEDS_YES, YES_SENTENCE, main };
