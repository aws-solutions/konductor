#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Helpers of run.sh. Free: reads the pinned bench, writes work dirs and results, never calls a model.
//   node prep.js family MODEL                     the model's author family (stage.js FAMILY), or "unknown"
//   node prep.js prompt KIND JOB NAME DIR ID...   prints the call's prompt; for write and recheck, fills DIR (the
//                                                 call's work dir); FROM (env) is the writer's result dir of a recheck
//   node prep.js result KIND STREAM DIR OUT       keeps the call's result at OUT; exit 3 when the call left none
//   node prep.js credits STREAM                   the call's real credits from its stream, or NaN
// Needs BENCH_REPO, the pinned checkout. Write, recheck and map follow the bench's own steps: the map prompt and its
// name filter are stage.js map's, a recheck bundle and prompt are standard-recheck's, a new task's prompt is its
// batch's author prompt (lib/prompt.js).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = process.env.BENCH_REPO;
const HERE = __dirname;
const RECHECK = path.join(HERE, '..', 'standard-recheck');
const stage = () => require(path.join(REPO, 'bench/scenarios/lib/stage.js'));
const readJson = (f) => require(path.join(REPO, 'bench/runner/lib/util.js')).readJson(f);
const batchOf = (id) => id.split('-')[0];
const isNew = (id) => id.startsWith('new:');
const bare = (id) => id.replace(/^new:/, '');
const node = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout;
};

/** Names and descriptions of every skill, SOP and agent of the pinned tree, as stage.js map shows them. */
function catalog() {
  return JSON.parse(node([path.join(REPO, 'bench/scenarios/t1/catalog-descriptions.js'), REPO]));
}

/** The map prompt of one task: its request, checks and rubric against the catalogue (stage.js map's template). */
function mapPrompt(id) {
  const task = readJson(path.join(REPO, 'bench/scenarios', batchOf(id), `${id}.json`));
  const text = JSON.stringify({ request: task.prompt, checks: task.checks, rubric: task.rubric }, null, 1);
  const list = catalog().map((c) => `- ${c.kind} ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
  const tmpl = fs.readFileSync(path.join(REPO, 'bench/scenarios/lib/prompts/map.md'), 'utf8');
  return tmpl.replace('{{TASK}}', () => text).replace('{{CATALOG}}', () => list);
}

const REWRITE = (ids) => `\n\n## How to work and what to leave\n\nThe current directory holds ${ids.map((i) => `\`tasks/${i}/\``).join(', ')}: \`task.json\` (the request in \`prompt\`, its \`checks\` and \`rubric\`), \`fixture/\` (the folder the agent starts in), \`hidden/\` (the hidden tests or key, copied over the folder root before they run), \`solution/\` (the reference change, an overlay on the fixture) and \`edits.md\` (earlier edits). Change these files in place; keep the task id and do not change \`version\`. Work only inside the current directory and use no network. Before you finish, run the hidden tests on the fixture with the solution laid over it, and on the untouched fixture. Then write \`rewrite.json\`: {"tasks": {"<id>": {"changed": ["paths you changed"], "why": "two or three sentences", "hiddenPass": {"solution": "n/m", "fixture": "n/m"}}}}. Then stop.\n`;

/** Fills DIR for a write call and returns its prompt. */
function writePrompt(job, name, dir, ids) {
  const brief = fs.readFileSync(path.join(HERE, 'prompts', `${job}-${name}.md`), 'utf8');
  const fresh = ids.filter(isNew).map(bare);
  const old = ids.filter((i) => !isNew(i));
  if (fresh.length && old.length) throw new Error(`${name}: one write call is either new tasks or existing ones`);
  if (fresh.length > 1) throw new Error(`${name}: one new task per write call`);
  fs.mkdirSync(dir, { recursive: true });
  if (fresh.length) {
    const id = fresh[0];
    const cfg = path.join(REPO, 'bench/scenarios', batchOf(id), 'scenario.config.js');
    return `${node([path.join(REPO, 'bench/scenarios/lib/prompt.js'), '--config', cfg, id])}\n\n${brief}`;
  }
  node([path.join(RECHECK, 'bundle.js'), dir, ...old], { BENCH_REPO: REPO });
  return brief + REWRITE(old);
}

/** Fills DIR for a recheck call from the pinned tree, or from the writer's result FROM, and returns its prompt. */
function recheckPrompt(dir, ids) {
  const from = process.env.FROM;
  if (!from) node([path.join(RECHECK, 'bundle.js'), dir, ...ids], { BENCH_REPO: REPO });
  else if (fs.existsSync(path.join(from, 'task-draft.json'))) {
    // A new task: the writer's own layout (stage.js assemble's input) becomes the bundle's tasks/<id>/.
    const [id] = ids;
    const dst = path.join(dir, 'tasks', id);
    fs.mkdirSync(dst, { recursive: true });
    for (const part of ['fixture', 'hidden', 'solution']) if (fs.existsSync(path.join(from, part))) fs.cpSync(path.join(from, part), path.join(dst, part), { recursive: true });
    fs.writeFileSync(path.join(dst, 'task.json'), `${JSON.stringify(readJson(path.join(from, 'task-draft.json')), null, 2)}\n`);
    fs.writeFileSync(path.join(dst, 'edits.md'), 'A new task, written from its brief by a second author family.\n');
  } else {
    fs.cpSync(path.join(from, 'tasks'), path.join(dir, 'tasks'), { recursive: true });
    const notes = fs.existsSync(path.join(from, 'rewrite.json')) ? readJson(path.join(from, 'rewrite.json')).tasks || {} : {};
    for (const id of ids) fs.writeFileSync(path.join(dir, 'tasks', id, 'edits.md'), `Rewritten by a second author family: ${notes[id]?.why ?? 'no notes'}\nChanged: ${(notes[id]?.changed || []).join(', ') || 'not listed'}\n`);
  }
  return fs.readFileSync(path.join(RECHECK, 'prompt.md'), 'utf8');
}

/** Keeps a call's result; false when it left none. Map: the reply's JSON with names outside the catalogue dropped. */
function keepResult(kind, stream, dir, out) {
  if (kind === 'map') {
    let r;
    try { r = stage().jsonIn(stage().streamInfo(stream).finalText); } catch { return false; }
    const known = new Set(catalog().map((c) => `${c.kind}:${c.name}`));
    r.targetSkills = (r.targetSkills || []).filter((n) => known.has(`skill:${n}`));
    if (r.targetSop && !known.has(`sop:${r.targetSop}`)) r.targetSop = null;
    if (r.targetAgent && !known.has(`agent:${r.targetAgent}`)) r.targetAgent = null;
    fs.writeFileSync(out, `${JSON.stringify(r, null, 2)}\n`);
    return true;
  }
  if (kind === 'recheck') {
    if (!fs.existsSync(path.join(dir, 'recheck.json'))) return false;
    fs.copyFileSync(path.join(dir, 'recheck.json'), out);
    return true;
  }
  if (!['rewrite.json', 'task-draft.json'].some((f) => fs.existsSync(path.join(dir, f)))) return false;
  fs.cpSync(dir, out, { recursive: true });
  return true;
}

function main() {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'family') { console.log(stage().FAMILY[a[0]] ?? 'unknown'); return; }
  if (cmd === 'credits') {
    try { console.log(stage().streamInfo(a[0]).credits.toFixed(3)); } catch { console.log('NaN'); }
    return;
  }
  if (cmd === 'prompt') {
    const [kind, job, name, dir, ...ids] = a;
    const text = kind === 'map' ? mapPrompt(ids[0]) : kind === 'write' ? writePrompt(job, name, dir, ids) : kind === 'recheck' ? recheckPrompt(dir, ids) : null;
    if (text === null) throw new Error(`unknown kind ${kind}`);
    process.stdout.write(text);
    return;
  }
  if (cmd === 'result') { process.exitCode = keepResult(...a) ? 0 : 3; return; }
  console.error('usage: see the top of prep.js');
  process.exitCode = 64;
}
main();
