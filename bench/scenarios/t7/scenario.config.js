// SPDX-License-Identifier: Apache-2.0
'use strict';

// T7's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t7/scenario.config.js [id ...] [--record]
//   node bench/scenarios/lib/answers.js --config bench/scenarios/t7/scenario.config.js lazy|alt [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t7/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t7/scenario.config.js prompt|author|fix|map|review|assemble <id> [FILE]   (needs T7_AUTH)
// A task's output is one document with a fenced JSON block tagged with the key's `block` (for example ```status),
// graded by plan-grade.cjs and plan.test.cjs (bench/scenarios/lib/hidden, named in each hidden dir's .bench-lib.json).
// The mechanical lazy answer adds the ids the key says must not be named (the decoys); the mapping prompt is the
// shared one, so every batch tags the same way.

const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const FAMILY = { 'gpt-5.6-luna': 'openai', 'deepseek-3.2': 'deepseek', 'glm-5': 'zhipu', 'qwen3-coder-next': 'alibaba', 'minimax-m2.5': 'minimax' };
const TEST_CMD = 'node --test --test-timeout=15000 hidden/*.test.*';
const GRADER_FILES = ['plan-grade.cjs', 'plan.test.cjs'];
const LIB_HIDDEN = path.join(DIR, '..', 'lib', 'hidden');
const ID = /^[A-Z][A-Z0-9]{0,9}-\d{1,5}$/;
const keyOf = (task) => JSON.parse(fs.readFileSync(path.join(DIR, 'hidden', task.hidden || task.id, 'hidden', 'key.json'), 'utf8'));

/** Ids the key says must not be named: the decoys. */
const decoysOf = (key) => [...new Set(key.assertions.filter((a) => a.op === 'absent' || a.op === 'excludes').flatMap((a) => a.ids || []).filter((x) => ID.test(x)))];

function render(id, lib) {
  const b = lib.brief(id);
  const src = typeof b.source === 'object' ? `${b.source.url} (${b.source.licence})` : 'original';
  const expert = b.expert
    ? `   - \`expertKey\`: \`{ "items": [{ "id", "text", "source" }], "weakAnswers": [3 to 5 strings] }\`: 5 to 8 risks, trade-offs or failure modes a strong answer to THIS request must address and that the key's assertions do not already check (judges read it, never the agent). Each item applies a practice from one of these public sources to this task's data, in your own words, and its \`source\` is that source's name and URL exactly as written here: ${b.expertSources.map((x) => `"${x}"`).join('; ')}. \`weakAnswers\` are 3 to 5 things a shallow answer would say.\n`
    : '';
  const twin = b.controlKind === 'twin'
    ? `- This is a near-miss twin of \`${b.twinOf}\`: \`fixture/\` is already here, copied from that task. Do not change it and do not write a new one; skip step 1 and \`authoring/generate.py\`. Write \`authoring/compute_key.py\`, \`hidden/key.json\`, \`solution/\` and \`task-draft.json\`, and set \`dataFile\` to the export file. The request wants plain numbers; it must not ask for a status, risks or a plan.\n`
    : '';
  const fill = { ID: id, PHASE: b.phase, ROLE: b.role, KIND: b.kind, SCENARIO: b.scenario, SEEDS: b.seeds, SOURCE: src, OUTPUT: b.output, BLOCK: b.block, SHAPE: b.shape, EXPERT: expert, TWIN: twin };
  return lib.read('prompts/author.md').replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
}

// The checks every T7 task carries besides the hidden test. The existence and unchanged-input checks are cheap to pass,
// so on their own they gave an empty-effort answer the whole checks share (D-86). `evidence` ties the share to the
// hidden key: the answer's block must name at least EVIDENCE_SHARE of the items the key requires (ids, paths, names
// from `includes`, `cites` and `order` assertions that need all of their items), so a shallow answer that finds only
// the obvious half fails it while any correct answer, however worded, passes.
const EVIDENCE_SHARE = 0.8;

/** The items a correct block must name, from the key (pure). */
function requiredItems(key) {
  const out = new Set();
  for (const a of key.assertions) {
    if (!['includes', 'cites', 'order'].includes(a.op) || a.any) continue;
    const ids = a.ids || [];
    const need = a.op === 'cites' ? Math.min(a.min ?? 1, ids.length) : ids.length;
    if (need === ids.length) for (const i of ids) if (typeof i === 'string' && i.trim()) out.add(i);
  }
  return [...out].sort();
}

/** The `cmd` check that the block names enough of the required items, or null when the key requires none (pure). */
function evidenceCheck(key) {
  const items = requiredItems(key);
  if (!items.length) return null;
  const need = Math.ceil(EVIDENCE_SHARE * items.length);
  // Runs in /bin/sh: the script sits in single quotes and uses no single quote or backtick itself.
  const js = `const t=require("fs").readFileSync(${JSON.stringify(key.output)},"utf8");`
    + `const f=String.fromCharCode(96).repeat(3);const s=t.split(f+${JSON.stringify(key.block)});if(s.length<2)process.exit(1);`
    + `const b=s[1].split(f)[0].toLowerCase();const w=(c)=>c!==undefined&&/[a-z0-9]/.test(c);`
    + `const named=(x)=>{let i=b.indexOf(x);while(i>=0){if(!w(b[i-1])&&!w(b[i+x.length]))return true;i=b.indexOf(x,i+1)}return false};`
    + `const items=${JSON.stringify(items.map((x) => x.toLowerCase()))};process.exit(items.filter(named).length>=${need}?0:1)`;
  return { type: 'cmd', cmd: `node -e '${js}'`, expectExit: 0, weight: 4, kind: 'substance' };
}

/** The checks of a T7 task: the hidden test, the evidence check, then the cheap checks at weight 1 (pure). */
function checksFor(b, key, dataFile) {
  return [
    { type: 'tests', cmd: TEST_CMD, min: key.assertions.length, weight: 3, kind: 'substance' },
    ...[evidenceCheck(key)].filter(Boolean),
    { type: 'file_exists', path: b.output, weight: 1, kind: 'substance' },
    { type: 'fixture_unchanged', path: dataFile, weight: 1, kind: 'substance' },
    { type: 'contains', path: b.output, pattern: `\`\`\`\\s*${b.block}`, weight: 1, kind: 'format' },
  ];
}

/** The task file for a brief, its author's draft, key, mapping and review (pure; `assemble` writes it). */
function taskOf(b, draft, key, mapping, rev, date = new Date().toISOString().slice(0, 10)) {
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
    checks: checksFor(b, key, draft.dataFile),
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

// Readies work/<id>/ for the author: the grader files in hidden/ (a twin also gets its real task's fixture), and the prompt.
function prompt(s, id) {
  const b = s.brief(id);
  const w = s.work(id);
  fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'hidden'), { recursive: true });
  for (const f of GRADER_FILES) fs.copyFileSync(path.join(LIB_HIDDEN, f), path.join(w, 'hidden', f));
  if (b.controlKind === 'twin') fs.cpSync(path.join(DIR, 'fixtures', b.twinOf), path.join(w, 'fixture'), { recursive: true });
  fs.writeFileSync(s.work(`${id}.prompt.txt`), require('../lib/prompt.js').render(s.cfg, id));
  return { id, dir: w };
}

function author(s, id) {
  const b = s.brief(id);
  const r = s.call(b.author, s.work(id), fs.readFileSync(s.work(`${id}.prompt.txt`), 'utf8'), `${id}.author`);
  s.logCall(id, 'author', b.author, r);
  return { credits: r.credits, seconds: r.seconds, draft: fs.existsSync(s.work(id, 'task-draft.json')) };
}

function fix(s, id, file) {
  const b = s.brief(id);
  const text = `${fs.readFileSync(s.work(`${id}.prompt.txt`), 'utf8')}\n\n## Fix round\n\nYou wrote this task in the current directory earlier. A reviewer and a dry run found the problems below. Fix them in place, keep everything else, and verify again as in step 6.\n\n${fs.readFileSync(file, 'utf8')}`;
  const r = s.call(b.author, s.work(id), text, `${id}.fix`);
  s.logCall(id, 'fix', b.author, r);
  return { credits: r.credits, seconds: r.seconds };
}

function buildTask(s, id) {
  const b = s.brief(id);
  const w = s.work(id);
  const draft = s.readJson(path.join(w, 'task-draft.json'));
  const key = s.readJson(path.join(w, 'hidden', 'key.json'));
  // A twin carries no targets of its own: its mustNotLoad is the real task's targets.
  const mapping = s.workJson(`${b.controlKind === 'twin' ? b.twinOf : id}.map.json`, s.NO_MAPPING);
  return taskOf(b, draft, key, mapping, s.workJson(`${id}.review.json`));
}

module.exports = {
  dir: DIR,
  canary: { node: 'hidden/zz-canary.test.js', python: 'hidden/py/test_zz_canary.py' },
  answers: (task) => { const key = keyOf(task); return { blockTags: [key.block], decoys: decoysOf(key) }; },
  prompt: { render },
  stage: {
    authEnv: 'T7_AUTH',
    timeoutMs: 2400000,
    mapFields: ['rubric', 'notes'],
    // A third family by default; T7_MAP_MODEL picks another when glm-5 maps nothing for a task whose units plainly fit.
    get mapModel() { return process.env.T7_MAP_MODEL || 'glm-5'; },
    logRow: (id, step, model, r) => `| ${id} | ${step} | ${model} | ${Math.round(r.seconds || 0)} | ${r.credits.toFixed(2)} |`,
    buildTask,
    layout: (s, id, task) => [
      ...(task.controlKind === 'twin' ? [] : [[s.work(id, 'fixture'), path.join(DIR, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(DIR, 'hidden', id, 'hidden')],
      [s.work(id, 'solution'), path.join(DIR, 'solutions', id)],
      [s.work(id, 'authoring'), path.join(DIR, 'authoring', id)],
      // Scored answers for the dry run: the author's lazy answer and the reviewer's alternative correct one.
      ...(fs.existsSync(s.work(id, 'lazy')) ? [[s.work(id, 'lazy'), path.join(DIR, 'answers', id, 'lazy')]] : []),
      ...(fs.existsSync(s.work(`${id}-review`, 'alt')) ? [[s.work(`${id}-review`, 'alt'), path.join(DIR, 'answers', id, 'alt')]] : []),
    ],
    commands: { prompt, author, fix },
  },
  taskOf,
  checksFor,
  evidenceCheck,
  requiredItems,
  decoysOf,
  TEST_CMD,
  GRADER_FILES,
};
