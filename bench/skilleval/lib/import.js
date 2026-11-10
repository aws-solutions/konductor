// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds bench tasks and trigger queries from the committed skill eval data (bench/skill-evals/skills/<skill>).
// Nothing here runs a model or the runner. The skills themselves come from a git ref; the data comes from the working tree.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256, readJson, writeJson, plain } = require('./util.js');
const { NO_QUESTIONS, JUDGES } = require('./emit.js');
const { PROMPT_BANNED } = require('./scenarios.js');
const { convertCheck, FORBIDS_EDITS } = require('./import-checks.js');
const { queryContentProblem } = require('../../cap/draft.js');

const BENCH = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(BENCH, '..');
const EVALS_DIR = path.join(BENCH, 'skill-evals', 'skills');
const SOURCE = 'skill-evals';
const MARKER = '.skilleval-import';
const EMPTY_FIXTURE = 'import-empty';
const KEY_FILE = '.bench-answer-key.md';
const TIMEOUT_SEC = 600;
const ANCHOR_MAX = 240;
const QUERY_MIN = 12;
const QUERY_MAX = 400;
const WEIGHT = { value: 3, guard: 2 };
const NEGATIVE = /^(does not|doesn't|do not|never|no |not |without|avoids?\b|refuses)/i;
const COPY_SKIP = new Set(['.git', 'node_modules']);

const suiteName = (skill) => `skilleval-import-${skill}`;
const trimDot = (s) => String(s).trim().replace(/[.\s]+$/, '');

function git(args, repo) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr).trim().split('\n')[0]}`);
  return r.stdout;
}

/** Names of the skills that have a SKILL.md in the tree of `ref`. */
function skillsAtRef(ref, repo = REPO) {
  const out = git(['ls-tree', '-r', '--name-only', ref, '--', 'skills'], repo);
  const names = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^skills\/([^/]+)\/SKILL\.md$/);
    if (m) names.add(m[1]);
  }
  return names;
}

const resolveRef = (ref, repo = REPO) => git(['rev-parse', '--verify', `${ref}^{commit}`], repo).trim();

function skillBlob(ref, skill, repo = REPO) {
  try { return git(['rev-parse', `${ref}:skills/${skill}/SKILL.md`], repo).trim(); } catch { return null; }
}

function listSkills(evalsDir = EVALS_DIR) {
  return fs.readdirSync(evalsDir).filter((n) => fs.existsSync(path.join(evalsDir, n, 'scenario.json'))).sort();
}

function loadSkillData(skill, evalsDir = EVALS_DIR) {
  const dir = path.join(evalsDir, skill);
  const file = (n) => path.join(dir, n);
  if (!fs.existsSync(file('scenario.json'))) return null;
  const scenario = readJson(file('scenario.json'));
  const evals = fs.existsSync(file('evals.json')) ? readJson(file('evals.json')).evals ?? [] : [];
  const queries = fs.existsSync(file('queries.json')) ? readJson(file('queries.json')) : [];
  return { skill, dir, scenario, evals, queries };
}

function listTree(root, rel = '') {
  const out = [];
  const here = path.join(root, rel);
  for (const e of fs.readdirSync(here, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (COPY_SKIP.has(e.name) || e.isSymbolicLink()) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listTree(root, r));
    else if (e.isFile()) out.push(r.split(path.sep).join('/'));
  }
  return out;
}

const slug = (s) => s.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9_]+/, '').replace(/-+$/, '');

/**
 * Where a task's workspace comes from. `ref` is a fixture path from the data ("fixtures/<skill>/<sub>/"), or null for none.
 * The nested path is flattened to one fixture name; `<top>.KEY.md` beside the top-level directory becomes the answer key.
 */
function fixtureSpec(skillDir, ref) {
  if (!ref) return { name: EMPTY_FIXTURE, files: [], key: null, setup: false, rel: null };
  const rel = ref.replace(/\/+$/, '');
  const abs = path.join(skillDir, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`fixture not found: ${ref}`);
  const inside = rel.replace(/^fixtures\//, '');
  const top = inside.split('/')[0];
  const keyFile = path.join(skillDir, 'fixtures', `${top}.KEY.md`);
  const files = listTree(abs);
  return {
    name: `fx-${slug(inside.replace(/\//g, '-'))}`, rel, abs, files, key: fs.existsSync(keyFile) ? keyFile : null,
    setup: files.some((f) => path.basename(f) === 'setup.sh'),
  };
}

function fixtureDigest(spec) {
  const parts = spec.files.map((f) => `${f}\0${sha256(fs.readFileSync(path.join(spec.abs, f)))}`);
  parts.push(`key\0${spec.key ? sha256(fs.readFileSync(spec.key)) : ''}`);
  return sha256(parts.join('\n'));
}

const EMPTY_NOTE = 'Empty workspace. The task is answered in the reply or in the files it names.\n';
const NO_KEY_NOTE = 'No answer key. Grade the work against the rubric only.\n';

function writeFixture(spec, destRoot) {
  const dest = path.join(destRoot, spec.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (!spec.abs) fs.writeFileSync(path.join(dest, 'README.md'), EMPTY_NOTE);
  for (const f of spec.files) {
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(path.join(spec.abs, f), path.join(dest, f));
  }
  if (spec.key) fs.copyFileSync(spec.key, path.join(dest, KEY_FILE));
  else fs.writeFileSync(path.join(dest, KEY_FILE), NO_KEY_NOTE);
}

/** Rubric item text: the criterion, plus the pass anchor when criterion and anchor together are short. */
function itemText(criterion, pass) {
  const c = trimDot(plain(criterion));
  const p = pass ? trimDot(plain(pass)) : '';
  return p && c.length + p.length <= ANCHOR_MAX ? `${c}. Pass: ${p}.` : `${c}.`;
}

class Rubric {
  constructor() { this.items = []; this.n = { value: 0, guard: 0 }; }

  add(bucket, criterion) {
    this.n[bucket] += 1;
    this.items.push({ id: `${bucket}-${this.n[bucket]}`, criterion, weight: WEIGHT[bucket] });
  }
}

/** Checks and the texts of the checks that could not be converted. */
function convertAll(entries) {
  const checks = [];
  const seen = new Set();
  const unsupported = [];
  const converted = new Set();
  for (const e of entries) {
    const r = convertCheck(e.check);
    if (r.unsupported) { unsupported.push({ text: e.text, reason: r.unsupported }); continue; }
    converted.add(e.text);
    for (const c of r.checks) {
      const k = JSON.stringify(c);
      if (!seen.has(k)) { seen.add(k); checks.push(c); }
    }
  }
  return { checks, unsupported, converted };
}

const withSentence = (prompt) => {
  const p = plain(prompt).trim();
  return p.endsWith(NO_QUESTIONS) ? p : `${p}\n\n${NO_QUESTIONS}`;
};

function taskShell(skill, id, prompt, fixture, checks, rubric) {
  return { id, class: 'simple', target: skill, prompt: withSentence(prompt), fixture, timeoutSec: TIMEOUT_SEC, checks, rubric, tiers: ['cap'] };
}

function scenarioTask(skill, p, extraChecks, fixture) {
  const rubric = new Rubric();
  for (const r of p.rubric) rubric.add(r.dimension === 'restraint' ? 'guard' : 'value', itemText(r.criterion, r.pass));
  const all = convertAll([...(p.floor_checks ?? []), ...extraChecks]);
  for (const u of all.unsupported) rubric.add('guard', `${trimDot(plain(u.text))}.`);
  return taskShell(skill, `si-${skill}-${p.id}`, p.prompt, fixture, all.checks, rubric.items);
}

function evalTask(skill, c, fixture) {
  const rubric = new Rubric();
  const all = convertAll(c.scripted_checks ?? []);
  let spare = (c.expectations ?? []).length - 3;
  for (const x of c.expectations ?? []) {
    if (all.converted.has(x) && spare > 0) { spare -= 1; continue; }
    rubric.add(NEGATIVE.test(x) ? 'guard' : 'value', `${trimDot(plain(x))}.`);
  }
  for (const u of all.unsupported) rubric.add('guard', `${trimDot(plain(u.text))}.`);
  return taskShell(skill, `si-${skill}-e${c.id}`, c.prompt, fixture, all.checks, rubric.items);
}

function problemsOf(task) {
  const out = [];
  if (PROMPT_BANNED.test(task.prompt)) out.push('prompt names a konductor procedure or agent');
  if (task.rubric.length < 3) out.push(`rubric has ${task.rubric.length} items, need at least 3`);
  return out;
}

/**
 * Everything the import would write for one skill, without writing it. Each candidate is { task, tags, fixture, provenance };
 * `skipped` holds { id, reason } for candidates that are dropped, `held` the ids kept back as limited.
 */
function planSkill({ skill, evalsDir = EVALS_DIR, includeLimited = false }) {
  const data = loadSkillData(skill, evalsDir);
  if (!data) return null;
  const limited = Boolean(data.scenario.limited);
  const candidates = [];
  const skipped = [];
  const held = [];
  const pairedEvals = new Set();
  const specs = new Map();
  const specFor = (rel) => {
    const key = rel ?? '';
    if (!specs.has(key)) specs.set(key, fixtureSpec(data.dir, rel));
    return specs.get(key);
  };
  const scenarios = data.scenario.prompts ?? [];
  const byId = new Map(scenarios.map((p) => [p.id, p]));
  const foldedInto = new Map();
  for (const c of data.evals) {
    const p = byId.get(c.scenario_prompt_id);
    if (p && plain(p.prompt).trim() === plain(c.prompt).trim()) {
      foldedInto.set(p.id, [...(foldedInto.get(p.id) ?? []), c]);
      pairedEvals.add(c.id);
    }
  }
  const add = (task, spec, extra) => {
    if (FORBIDS_EDITS.test(task.prompt) && spec.files.length) task.checks.push({ type: 'fixture_unchanged', path: '.', allowAdditions: true });
    const tags = [...extra.tags];
    if (limited) tags.push('limited');
    candidates.push({ task, tags, fixture: spec, scenario: extra.scenario, evals: extra.evals });
  };
  for (const p of scenarios) {
    const folded = foldedInto.get(p.id) ?? [];
    const spec = specFor(p.fixture);
    add(scenarioTask(skill, p, folded.flatMap((c) => c.scripted_checks ?? []), spec.name), spec, { tags: [], scenario: p.id, evals: folded.map((c) => c.id) });
  }
  for (const c of data.evals) {
    if (pairedEvals.has(c.id)) continue;
    const rel = (c.files ?? [])[0] ?? null;
    const spec = specFor(rel);
    const tags = byId.has(c.scenario_prompt_id) ? ['eval-paired-distinct'] : ['eval-only'];
    add(evalTask(skill, c, spec.name), spec, { tags, scenario: byId.has(c.scenario_prompt_id) ? c.scenario_prompt_id : null, evals: [c.id] });
  }
  const tasks = [];
  for (const cand of candidates) {
    const id = cand.task.id;
    const bad = problemsOf(cand.task);
    if (cand.fixture.setup) { skipped.push({ id, reason: 'limited: fixture needs setup.sh and the task schema has no setup command' }); continue; }
    if (bad.length) { skipped.push({ id, reason: bad.join('; ') }); continue; }
    if (cand.tags.includes('limited') && !includeLimited) { held.push(id); continue; }
    tasks.push({
      ...cand,
      provenance: {
        source: SOURCE, skill, scenario: cand.scenario, evals: cand.evals, tags: cand.tags, fixture: cand.fixture.name,
        contentSha256: sha256(JSON.stringify({ task: cand.task, fixture: fixtureDigest(cand.fixture) })),
      },
    });
  }
  tasks.sort((a, b) => (a.task.id < b.task.id ? -1 : 1));
  const fixtures = [...new Map(tasks.map((t) => [t.fixture.name, t.fixture])).values()];
  return {
    skill, limited, tasks, skipped, held, fixtures,
    counts: { scenarios: scenarios.length, evals: data.evals.length, folded: pairedEvals.size, evalOnly: data.evals.length - pairedEvals.size, queries: data.queries.length },
  };
}

/** Writes DIR/<skill>/tasks, the suite file, the oracle manifest and provenance.json. Returns the paths. */
function writeSkill(plan, { outDir, ref, resolved, blob, benchDir = BENCH, suitesDir }) {
  const skillOut = path.join(outDir, plan.skill);
  const tasksDir = path.join(skillOut, 'tasks');
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tasksDir, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(tasksDir, MARKER), 'Tasks imported by bench/skilleval/import.js from the skill eval data. Checks run in the scratch copy; the rubric is judged.\n');
  for (const f of plan.fixtures) writeFixture(f, path.join(tasksDir, 'fixtures'));
  for (const t of plan.tasks) writeJson(path.join(tasksDir, `${t.task.id}.json`), t.task);
  const ids = plan.tasks.map((t) => t.task.id);
  writeJson(path.join(skillOut, 'provenance.json'), {
    schemaVersion: 1, source: SOURCE, skill: plan.skill, ref, refSha: resolved, skillBlob: blob,
    tasks: Object.fromEntries(plan.tasks.map((t) => [t.task.id, t.provenance])),
  });
  const suites = suitesDir ?? path.join(skillOut, 'suites');
  const rel = path.relative(benchDir, tasksDir).split(path.sep).join('/');
  const suiteFile = path.join(suites, `${suiteName(plan.skill)}.json`);
  writeJson(suiteFile, { extraTasks: [rel], tasks: ids, arms: ['vanilla', 'main'], replicates: 1, judges: JUDGES, parallel: 1 });
  writeJson(path.join(skillOut, 'oracle-manifest.json'), {
    schemaVersion: 1, suite: suiteName(plan.skill),
    purpose: 'Oracle arm: put the skill body in front of every prompt.',
    tasks: ids.map((id) => ({ id, entries: [{ expectedSkills: [plan.skill] }] })),
  });
  return { tasksDir, suiteFile, ids };
}

/** Trigger rows in the `cap import` format, with the rows that `cap import` would reject listed in `dropped`. */
function filterQueries(skill, rows) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  for (const [i, x] of rows.entries()) {
    const text = typeof x?.query === 'string' ? x.query.trim() : '';
    let why = null;
    if (!text) why = 'query must be a non-empty string';
    else if (typeof x.should_trigger !== 'boolean') why = 'should_trigger must be true or false';
    else if (text.length < QUERY_MIN || x.query.length > QUERY_MAX) why = `the text must be between ${QUERY_MIN} and ${QUERY_MAX} characters`;
    else why = queryContentProblem(x.query, { capName: skill });
    if (!why) {
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) why = 'duplicate query text'; else seen.add(key);
    }
    if (why) dropped.push({ index: i + 1, query: text.slice(0, 80), reason: why });
    else kept.push({ query: x.query, should_trigger: x.should_trigger });
  }
  const load = kept.filter((x) => x.should_trigger).length;
  const none = kept.length - load;
  const warnings = [];
  if (load < 6 || none < 6) warnings.push(`only ${load} should_trigger true and ${none} false; cap import needs at least 6 of each`);
  if (kept.length > 64) warnings.push(`${kept.length} rows; cap import takes at most 64`);
  return { kept, dropped, warnings };
}

module.exports = {
  BENCH, REPO, EVALS_DIR, MARKER, EMPTY_FIXTURE, KEY_FILE, TIMEOUT_SEC, suiteName, skillsAtRef, resolveRef, skillBlob, listSkills, loadSkillData,
  fixtureSpec, fixtureDigest, writeFixture, itemText, planSkill, writeSkill, filterQueries,
};
