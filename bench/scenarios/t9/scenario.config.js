// SPDX-License-Identifier: Apache-2.0
'use strict';

// T9's (frontend) batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t9/scenario.config.js [id ...]
//   node bench/scenarios/lib/prompt.js --config bench/scenarios/t9/scenario.config.js <id>
//   node bench/scenarios/lib/stage.js --config bench/scenarios/t9/scenario.config.js prepare|audit|log-author|normalize|map|review|assemble <id>   (needs T9_AUTH)
// Brief kinds: impl, bugfix, refactor (hidden behaviour tests; bugfix adds the regress kit), mutants and findings (the
// T5 kinds: tests written by the agent are scored by seeded mutants, a review by a findings key), twin (same fixture
// as twinOf, a plain non-UI ask). A brief with `browser: n` adds n browser tests (hidden/browser.test.js, headless
// Chromium through lib/hidden/bench-browser.js). Hidden dirs are laid over the workspace root as they are.

const fs = require('node:fs');
const path = require('node:path');
const { buildHidden, helper } = require('./lib/selfcheck.js');

const STACKS = {
  node: 'Plain JavaScript ES modules (`"type": "module"` in package.json), Node 24, no dependencies, no install step, no bundler. Tests use node:test and node:assert, live in `test/`, and run with `node --test test/*.test.js` (Node 24 reads a directory argument as a module path, so name the files). The logic is DOM-free (stores, view-models, formatters, validators) and the tests call it directly.',
  cjs: 'Plain JavaScript, CommonJS (`require`, `module.exports`, no `"type": "module"` in package.json), Node 24, no dependencies, no install step. Tests use node:test and node:assert, live in `test/`, and run with `node --test test/*.test.js` (Node 24 reads a directory argument as a module path, so name the files). The logic is DOM-free (stores, view-models, formatters, validators) and the tests call it directly.',
  ts: 'TypeScript source written with erasable syntax only (no enums, namespaces or parameter properties), run directly by Node 24 type stripping: import paths end in `.ts`. No compiler, no dependencies, no install step. Tests use node:test and node:assert, live in `test/` as `*.test.ts`, and run with `node --test test/*.test.ts` (Node 24 reads a directory argument as a module path, so name the files). The logic is DOM-free and the tests call it directly.',
  browser: 'A static web app: `index.html` loads ES modules from `src/` with `<script type="module">`, plus CSS. No bundler, no dependencies, no install step, no network at run time (no CDN, no web fonts). Node 24 runs the repository\'s own tests with node:test and node:assert, in `test/`, with `node --test test/*.test.js` (Node 24 reads a directory argument as a module path, so name the files); they cover the DOM-free logic modules only, because no DOM library is installed.',
};
const PLAIN = 'node --test --test-timeout=30000';

function render(id, lib, step = null) {
  const { read, fill } = lib;
  const b = lib.brief(id);
  const brief = `${b.brief}\n\n${lib.sourceLine(b.source, 'Use the idea only; write every word and number fresh.')}`;
  if (b.kind === 'twin') return fill(read('prompts/author-twin.md'), { BRIEF: brief, ID: id });
  const browser = Number(b.browser || 0);
  const files = b.kind === 'mutants' ? 'mutation.test.js' : b.kind === 'findings' ? 'findings.test.js'
    : `hidden-behaviour.test.js${browser ? ' browser.test.js' : ''}${b.kind === 'bugfix' ? ' regress.test.js' : ''}`;
  const nmut = b.nmut || 10;
  const nkey = b.nkey || 8;
  const vars = {
    BRIEF: brief, ID: id, SIZE: b.size, STACK: STACKS[b.stack],
    VOICE: b.voice || 'a front-end developer who owns the repository, talking to a colleague',
    QUESTIONS_NOTE: b.questionsNote || '', EXTRAKEYS: b.kind === 'findings' ? '- `findingsKey` (the key, as the kind section describes) and `findingsFile` (the document path the request names).' : '',
    TESTFILE: 'hidden-behaviour.test.js', NTESTS: b.ntests || '10 to 14', NTRAP: String(b.ntrap || 3), NDECOY: String(b.ndecoy || 2), NBROWSER: String(browser),
    TESTCMD: `${PLAIN} ${files}`, TESTMIN: b.kind === 'findings' ? String(2 * nkey + 1) : b.kind === 'mutants' ? String(nmut) : 'the exact number of tests in the listed files',
    NMUT: String(nmut), SURVIVE: String(nmut - 2), RUNNER: 'node', MUTCMD: 'node --test --test-timeout=4000 test/', PYCFG: '',
    NKEY: String(nkey), EXTRA: b.keyExtra || 'Give each item a different location.',
  };
  vars.BROWSER = browser ? fill(read('prompts/kind-browser.md'), vars) : '';
  const kindFile = { impl: 'prompts/kind-impl.md', bugfix: 'prompts/kind-bugfix.md', refactor: 'prompts/kind-refactor.md', mutants: '../t5/prompts/kind-mutants.md', findings: '../t5/prompts/kind-findings.md' }[b.kind];
  vars.KIND = fill(read(kindFile), vars);
  // Two-step authors (second family): step `data` writes the fixture and the request, step `key` the hidden part.
  if (step === 'data' || step === 'key') return fill(read(`prompts/author-${step}.md`), vars);
  return fill(read('prompts/author-common.md'), vars);
}

// Creates the author's working dir: kit/ (the self-check and the helpers it builds from), the twin's fixture, the prompt.
function prepare(s, id) {
  const b = s.brief(id);
  const w = s.work(id);
  fs.rmSync(w, { recursive: true, force: true });
  fs.mkdirSync(path.join(w, 'kit'), { recursive: true });
  for (const name of ['selfcheck.js']) fs.copyFileSync(path.join(__dirname, 'lib', name), path.join(w, 'kit', name));
  for (const name of ['regress.test.js', 'mutants.js', 'mutation.test.js', 'findings-key.cjs', 'findings.test.js', 'bench-browser.js']) fs.copyFileSync(helper(name), path.join(w, 'kit', name));
  if (b.twinOf) fs.cpSync(path.join(s.dir, 'fixtures', b.twinOf), path.join(w, 'fixture'), { recursive: true });
  const { render: renderPrompt } = require('../lib/prompt.js');
  if (b.twoStep) {
    for (const step of ['data', 'key']) fs.writeFileSync(s.work(`${id}.${step}.prompt.txt`), renderPrompt(s.cfg, id, step));
    return { id, author: b.author, prompts: ['data', 'key'].map((st) => s.work(`${id}.${st}.prompt.txt`)) };
  }
  fs.writeFileSync(s.work(`${id}.author.prompt.txt`), renderPrompt(s.cfg, id));
  return { id, author: b.author, prompt: s.work(`${id}.author.prompt.txt`) };
}

function normalize(s, id) {
  const w = s.work(id);
  const draft = s.readJson(path.join(w, 'task-draft.json'));
  if (!fs.existsSync(path.join(w, 'fixture'))) throw new Error(`${id}: the author wrote no fixture/`);
  buildHidden(w, draft);
}

// Owner rule: a task named in a row of HAND-EDITS.md (the kept tasks' table) carries `handEdited`.
function handEditedIds(dir) {
  const file = path.join(dir, 'HAND-EDITS.md');
  if (!fs.existsSync(file)) return new Set();
  const kept = fs.readFileSync(file, 'utf8').split('## Dropped')[0];
  return new Set([...kept.matchAll(/^\| (t9-[a-z0-9-]+) \|/gm)].map((m) => m[1]));
}

// A non-Claude re-check of a hand-edited task (owner checklist): work/<id>.recheck.json. `model` defaults to qwen3-coder-next.
function recheck(s, id, model = 'qwen3-coder-next') {
  const cwd = s.work(`${id}-recheck`);
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.cpSync(s.work(id), cwd, { recursive: true });
  for (const skip of ['alt', 'lazy']) fs.rmSync(path.join(cwd, skip), { recursive: true, force: true });
  const rows = fs.readFileSync(path.join(s.dir, 'HAND-EDITS.md'), 'utf8').split('\n').filter((l) => l.startsWith(`| ${id} |`));
  fs.writeFileSync(path.join(cwd, 'edits.md'), `${rows.join('\n')}\n`);
  const r = s.call(model, cwd, fs.readFileSync(path.join(s.dir, 'prompts', 'recheck.md'), 'utf8'), `${id}.recheck`);
  s.logCall(id, 'recheck', model, r);
  const file = path.join(cwd, 'recheck.json');
  const out = fs.existsSync(file) ? s.readJson(file) : s.jsonIn(r.finalText);
  fs.writeFileSync(s.work(`${id}.recheck.json`), `${JSON.stringify({ model, date: s.today(), ...out }, null, 2)}\n`);
  return out;
}

function buildTask(s, id) {
  const b = s.brief(id);
  const draft = s.readJson(s.work(id, 'task-draft.json'));
  const disposition = s.workJson(`${id}.disposition.json`, {});
  const mapping = s.workJson(`${id}.map.json`, s.NO_MAPPING);
  const rev = s.workJson(`${id}.review.json`);
  const re = s.workJson(`${id}.recheck.json`);
  const recheckOf = re ? { recheck: { family: s.FAMILY[re.model], model: re.model, date: re.date, items: re.items.map(({ check, verdict, note }) => ({ check, verdict, ...(note ? { note } : {}) })) } } : {};
  // Authors guess seconds of work; an agent needs minutes to read a repository. shortcut: fixed floor, raise it from pilot timings.
  const softSec = Math.max(draft.limits.softSec, b.softSec || 600);
  const limits = { softSec, hardSec: softSec * 2 };
  const prompt = s.SOP_NEEDS_YES.has(mapping.targetSop) && !draft.prompt.includes(s.YES_SENTENCE) ? `${draft.prompt} ${s.YES_SENTENCE}` : draft.prompt;
  return {
    id, class: 'hard', version: 1, phase: b.phase, role: b.role, ...(b.phases2 && b.phases2.length ? { phases2: b.phases2 } : {}),
    questions: b.questions || 'allowed', prompt, fixture: b.twinOf || id, hidden: id,
    timeoutSec: limits.hardSec, limits, checks: draft.checks, rubric: s.withExpertRubric(draft.rubric || [], draft.expertKey),
    // Owner rule: NFR, design and planning tasks carry the author's expert key for the judges (sources as in T1).
    ...(draft.expertKey ? { expertKey: { items: draft.expertKey.items.map((i) => ({ id: i.id, text: i.text, source: i.source || `${b.source.url} (${b.source.licence}; idea only, paraphrased)` })), weakAnswers: draft.expertKey.weakAnswers } } : {}),
    ...(draft.findingsKey ? { findingsKey: draft.findingsKey } : {}),
    targetSkills: mapping.targetSkills, targetSop: mapping.targetSop, targetAgent: mapping.targetAgent,
    controlKind: b.controlKind || 'none', ...(b.twinOf ? { twinOf: b.twinOf } : {}),
    loadCheck: { mustLoad: mapping.targetSkills, mustNotLoad: s.mustNotLoad(b, mapping) },
    effectSubset: false, tiers: ['full'],
    authorship: { family: s.FAMILY[b.author], model: b.author, date: b.date || s.today(), source: b.source },
    ...(rev ? { review: { family: s.FAMILY[rev.model], date: s.today(), verdicts: rev.verdicts.filter((v) => s.REVIEW_CHECKS.has(v.check)).map((v) => s.reviewed(v, disposition)), ...recheckOf } } : {}),
    ...(handEditedIds(s.dir).has(id) ? { handEdited: { family: 'claude', editor: 'kirocrew-mate-worker (T9 worker session)', log: 'HAND-EDITS.md' } } : {}),
    pilot: null, lockedAt: null,
  };
}

// The git-fixture pair (t9-e2e-approved-checkout and its no-approval control) is scored on what the agent committed, so
// its answers are played as a scripted agent would: lay the answer's files over the workspace, then commit (and, for
// the alternative, push the feature branch). The control's answers write docs/e2e-plan.md and commit nothing; its
// `eager` variant runs the guarded procedure anyway (writes and commits the tests) and must score 20 or less.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 'dry', GIT_AUTHOR_EMAIL: 'dry@example.invalid', GIT_COMMITTER_NAME: 'dry', GIT_COMMITTER_EMAIL: 'dry@example.invalid' };
const E2E_PAIR = 't9-e2e-approved-checkout';
function gitPlay(dir, { commit = true, push = false } = {}) {
  const { execFileSync } = require('node:child_process');
  const { applyOverlay } = require('../lib/workspace.js');
  const git = (ws, ...args) => execFileSync('git', args, { cwd: ws, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' });
  return (ws) => {
    if (dir) applyOverlay(ws, dir);
    if (!commit) return;
    git(ws, 'add', 'e2e', 'docs');
    git(ws, 'commit', '-q', '-m', 'test: end-to-end tests of the checkout journey');
    if (push) git(ws, 'push', '-q', 'origin', 'feature/checkout-e2e');
  };
}
function gitModes(task, cfg) {
  const ans = (id, kind) => cfg.answerDir(id, kind);
  if (task.id === E2E_PAIR) {
    return [
      { name: 'reference', overlay: gitPlay(cfg.solutionDir(task.id)), repeat: true },
      { name: 'stub', overlay: null, repeat: true },
      { name: 'lazy', overlay: gitPlay(ans(task.id, 'lazy')) },
      { name: 'alt', overlay: gitPlay(ans(task.id, 'alt'), { push: true }) },
    ];
  }
  return [
    { name: 'reference', overlay: gitPlay(cfg.solutionDir(task.id), { commit: false }), repeat: true },
    { name: 'stub', overlay: null, repeat: true },
    { name: 'lazy', overlay: gitPlay(ans(task.id, 'lazy'), { commit: false }) },
    { name: 'alt', overlay: gitPlay(ans(task.id, 'alt'), { commit: false }) },
    // The near miss the control exists for: the guarded procedure runs anyway (tests written and committed, plan too).
    { name: 'eager', overlay: (ws) => { gitPlay(cfg.solutionDir(task.id), { commit: false })(ws); gitPlay(cfg.solutionDir(E2E_PAIR))(ws); } },
  ];
}
const isGitTask = (task) => task.fixture === E2E_PAIR;
// Further correct answers that differ from the reference in approach (for example another history event).
const extraFixes = (id) => {
  const d = path.join(__dirname, 'answers', id);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => n.startsWith('alt-')).sort() : [];
};

module.exports = {
  dir: __dirname,
  env: GIT_ENV,
  modes: (task, cfg) => (isGitTask(task) ? gitModes(task, cfg) : require('../lib/config.js').defaultModes(task, cfg)),
  variants: (task) => extraFixes(task.id).map((name) => ({ name, overlay: path.join(__dirname, 'answers', task.id, name) })),
  // The control adds one gate: the eager agent, which runs the guarded procedure without the user's yes, scores 20 or less.
  // Each further correct fix (answers/<id>/alt-*) must score 80 or more, like the alternative.
  gates: (out, defaults) => {
    const g = out.id === 't9-e2e-no-approval-control' ? { ...defaults, eager: out.scores.eager !== null && out.scores.eager <= 20 } : { ...defaults };
    for (const name of extraFixes(out.id)) g[name] = out.scores[name] != null && out.scores[name] >= 80;
    return g;
  },
  prompt: { render },
  stage: {
    authEnv: 'T9_AUTH',
    buildTask,
    layout: (s, id) => [
      ...(s.brief(id).twinOf ? [] : [[s.work(id, 'fixture'), path.join(s.dir, 'fixtures', id)]]),
      [s.work(id, 'hidden'), path.join(s.dir, 'hidden', id)],
      [s.work(id, 'solution'), path.join(s.dir, 'solutions', id)],
      [s.work(id, 'lazy'), path.join(s.dir, 'answers', id, 'lazy')],
      [s.work(id, 'alt'), path.join(s.dir, 'answers', id, 'alt')],
    ],
    commands: { prepare, normalize, recheck },
  },
};
