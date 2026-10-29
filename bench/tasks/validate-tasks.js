#!/usr/bin/env node
'use strict';

// Offline validator for bench/tasks, bench/fixtures and bench/suites.
// Usage: node bench/tasks/validate-tasks.js
//
// For every task it checks the schema shape, then runs the task's checks twice
// in a throwaway copy of the fixture:
//   1. untouched fixture: at least one check must fail (the task cannot pass
//      by doing nothing), and no cmd check may be broken (exit 127, SyntaxError).
//   2. fixture plus tasks/solutions/<id>/ overlay: every check must pass.
// Document tasks (classes sop, review, design) must also have a keyword-only
// stub in tasks/stubs/<id>/ that fails at least one substance check (a
// min_matches or cmd check), and the stub run is laid over the reference solution.
// Tolerant checks also need tasks/negatives/<id>.json: documents a check must reject (and
// accept), see runner/lib/negatives.js.
// Real tasks (class "real") run on a pinned upstream repository and are checked offline against bench/real/manifest.json:
// the entry must be validated, its vendored test files, license and notice must be present, and the list files must
// match their pins. The deeper proof (the real fix passes, the base fails, offline, deterministic, source location)
// is bench/real/validate-real.js and needs the upstream cache.
// Autonomy tasks (class "autonomy") leave a decision open on purpose and answer the agent's questions from a
// fixed list (see validate-autonomy.js): the prompt must not end with the no-questions sentence, the hidden tests
// are split into intended/ and invariants/, the reference solution passes both, the untouched fixture fails an
// intended test, and at least two alternative-interpretation partials each fail an intended test and pass every invariant.
// Hard tasks (class "hard") add hidden acceptance tests (a `tests` check, files under tasks/hidden/<id>/):
// the reference solution must pass every hidden test twice with the same counts and in under 60 s, the
// untouched fixture must fail at least 30 percent of them, and at least two partial solutions under
// tasks/partials/<id>/<name>/ must each score strictly between 0 and 100 percent, with different counts.
// Check semantics live in runner/lib/check-matcher.js, shared with the runner.
// Suite judges are validated with the family rules from judge/config.js.
// Files starting with "_" in bench/tasks (for example the runner smoke task)
// are skipped.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck: sharedEvalCheck, CHECK_TYPES, PATTERN_FLAGS, ANSWER_KEY } = require('../runner/lib/check-matcher.js');
const { checkPanel, checkJudgeModel } = require('../judge/config.js');
const { loadCases, checkCases } = require('../runner/lib/negatives.js');
const reallib = require('../real/lib.js');
const autonomyRules = require('./validate-autonomy.js');

const BENCH = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(BENCH, 'tasks');
const FIXTURES_DIR = path.join(BENCH, 'fixtures');
const SUITES_DIR = path.join(BENCH, 'suites');
const SOLUTIONS_DIR = path.join(TASKS_DIR, 'solutions');
const STUBS_DIR = path.join(TASKS_DIR, 'stubs');
const NEGATIVES_DIR = path.join(TASKS_DIR, 'negatives');
const HIDDEN_DIR = path.join(TASKS_DIR, 'hidden');
const PARTIALS_DIR = path.join(TASKS_DIR, 'partials');

const CLASSES = ['simple', 'sop', 'orchestration', 'review', 'design', 'hard', 'real', 'autonomy'];
const TIERS = ['lite', 'full', 'hard', 'real', 'autonomy', 'pilot'];
const REAL_RUBRIC_SIZE = 3;
const REAL_MIN_TASKS = 6;
const REAL_MAX_TASKS = 8;
const REAL_MIN_CROSS_FILE_BUGS = 3;
const REAL_MIN_FEATURES = 2;
const ALLOWED_REAL_LICENSES = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC']);
const REAL_NOTICE = path.join(BENCH, 'real', 'NOTICE');
const MAX_FIXTURE_FILES = 15;
// Fixtures used only by hard tasks may be larger.
const MAX_HARD_FIXTURE_FILES = 40;
// Fixtures used only by autonomy tasks: 15 to 30 files.
const MAX_AUTONOMY_FIXTURE_FILES = 30;
const HARD_MIN_TIMEOUT = 900;
const HARD_MAX_TIMEOUT = 1500;
const HARD_MAX_FIXTURE_PASS = 0.7;
const HIDDEN_MAX_SECONDS = 60;
const MIN_PARTIALS = 2;
const LITE_MAX_TIMEOUT = 600;
const LITE_TASKS = 5;
const LITE_MIN_FIXTURES = 3;
const LITE_MIN_CLASSES = 4;
const MIN_JUDGES = 3;
// Pinned subject model of the benchmark; judges may not share its family.
const SUBJECT_MODEL = 'claude-sonnet-5.5';
// Every prompt ends with this sentence so no arm is penalised for asking questions.
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
// Classes whose output is a document: they need a keyword-only stub (mutation proof).
const DOC_CLASSES = ['sop', 'review', 'design'];
// Prompts that forbid edits need a fixture_unchanged check on what must stay put.
const FORBIDS_EDITS = /do not (change|modify|delete|edit)[^.]*\b(tests?|source|code|files?)\b|without (changing|modifying) the tests/i;
// A neutral listing of every verdict word: a verdict check must not match it.
const VERDICT_LISTING = 'Possible verdicts: READY FOR CR, NEEDS FIXES, NOT READY, READY FOR RELEASE, PASS, FAIL.\nThe verdict is one of PASS or FAIL.\nVerdict options: NEEDS FIXES or READY FOR CR.\n';

// Expected result of the fixture's own test command on the untouched fixture.
const FIXTURE_BASELINE = {
  textkit: { cmd: 'node --test', exit: 1 },
  'inventory-api': { cmd: 'node --test', exit: 0 },
  'product-spec': null,
  // Hard fixtures: the visible tests pass before and after the work, so they cannot hide the defects.
  'hard-quota': { cmd: 'node --test', exit: 0 },
  'hard-jobs': { cmd: 'node --test', exit: 0 },
  'hard-invoice': { cmd: 'node --test', exit: 0 },
  'hard-contacts': { cmd: 'node --test', exit: 0 },
  'hard-migrate': { cmd: 'node --test', exit: 0 },
  'hard-billing': { cmd: 'node --test', exit: 0 },
  // Autonomy fixtures: the visible tests pass before and after the work.
  'auto-gateway': { cmd: 'node --test', exit: 0 },
  'auto-reports': { cmd: 'node --test', exit: 0 },
  'auto-crm': { cmd: 'node --test', exit: 0 },
  'auto-league': { cmd: 'node --test', exit: 0 },
  'auto-units': { cmd: 'node --test', exit: 0 },
  'auto-storage': { cmd: 'node --test', exit: 0 },
};

// Prompts must not name konductor procedures.
const PROMPT_BANNED = /\bk-[a-z-]+\b|\bSOP\b|konductor|kiro-spec-workflow/i;
// Hard prompts also never hint at the evaluation or at tooling.
// Real prompts also name no pull request, issue number, link or upstream hosting site.
const REAL_PROMPT_BANNED = /https?:\/\/|github|gitlab|\bpull request|\bPR\b|\bissue\s*#?\d|#\d{2,}|\bchangelog entry of|\bupstream\b/i;
const HARD_PROMPT_BANNED = /\b(hidden|graders?|grading|graded|reviewers?|agents?|subagents?|skills?|benchmarks?|acceptance tests?)\b/i;
// Public-repo hygiene scan (built from parts so this file does not match itself).
const INTERNAL_REF = new RegExp(
  ['amaz' + 'on', 'bra' + 'zil', 'mid' + 'way', 'isen' + 'gard', 'quip', 'corp\\.', 'dev-dsk', '\\bCR-\\d', '\\bSIM\\b'].join('|'),
  'i',
);
const DASHES = /[\u2013\u2014]/;

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isInt = (v) => Number.isInteger(v);

function readJson(file, where) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    err(where, `cannot parse JSON: ${e.message}`);
    return null;
  }
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

const fixtureDir = (name) => path.join(FIXTURES_DIR, name);

function copyFixture(name, overlayDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-validate-'));
  fs.cpSync(path.join(FIXTURES_DIR, name), tmp, {
    recursive: true,
    filter: (src) => path.basename(src) !== ANSWER_KEY,
  });
  if (overlayDir) fs.cpSync(overlayDir, tmp, { recursive: true });
  return tmp;
}

// Same matcher the runner uses. `pristine` is the fixture dir for fixture_unchanged.
function evalCheck(dir, check, pristine, hiddenDir = null) {
  const r = sharedEvalCheck(dir, check, { pristineDir: pristine, hiddenDir });
  const broken = (check.type === 'cmd' && (r.exit === 127 || /SyntaxError|ReferenceError/.test(r.stderr) || Boolean(r.signal)))
    || (check.type === 'tests' && Boolean(r.tests?.unparsed));
  return { pass: r.passed, broken, detail: r.detail, tests: r.tests };
}

function validateShape(file, t) {
  const where = path.basename(file);
  const need = (cond, msg) => { if (!cond) err(where, msg); };
  need(isStr(t.id), 'id must be a non-empty string');
  need(where === `${t.id}.json`, `file name must be <id>.json (id is "${t.id}")`);
  need(CLASSES.includes(t.class), `class must be one of ${CLASSES.join('|')}`);
  need(t.target === null || isStr(t.target), 'target must be a string or null');
  need(isStr(t.prompt), 'prompt must be a non-empty string');
  const real = t.class === 'real';
  if (real) need(t.fixture === undefined, 'real tasks have no fixture; the base tree comes from the real-repository cache');
  else need(isStr(t.fixture), 'fixture must be a non-empty string');
  need(isInt(t.timeoutSec) && t.timeoutSec > 0, 'timeoutSec must be a positive integer');
  need(Array.isArray(t.checks) && t.checks.length > 0, 'checks must be a non-empty array');
  need(Array.isArray(t.rubric) && t.rubric.length >= 3 && t.rubric.length <= 6, 'rubric must have 3 to 6 entries');
  if (real) need(Array.isArray(t.rubric) && t.rubric.length === REAL_RUBRIC_SIZE, `real tasks need exactly ${REAL_RUBRIC_SIZE} rubric criteria`);
  need(Array.isArray(t.tiers) && t.tiers.length > 0 && t.tiers.every((x) => TIERS.includes(x)), `tiers must be a non-empty subset of ${TIERS.join('|')}`);
  const hard = t.class === 'hard';
  const autonomy = t.class === 'autonomy' || t.autonomy !== undefined;
  // "pilot" is added on top of a task's own tier; the rules below look at the tiers without it.
  const ownTiers = Array.isArray(t.tiers) ? t.tiers.filter((x) => x !== 'pilot') : [];
  if (Array.isArray(t.tiers)) {
    if (autonomy) { /* tiers are checked with the other autonomy rules */ }
    else if (hard) need(ownTiers.length === 1 && ownTiers[0] === 'hard', 'hard tasks must have tiers ["hard"] (and optionally "pilot") only');
    else if (real) need(ownTiers.length === 1 && ownTiers[0] === 'real', 'real tasks must have tiers ["real"] (and optionally "pilot") only; the full tier does not include them');
    else need(t.tiers.includes('full') && !t.tiers.includes('hard') && !t.tiers.includes('real'), 'every task must include the full tier (and only hard tasks the hard tier, only real tasks the real tier)');
  }
  if (hard) {
    need(isInt(t.timeoutSec) && t.timeoutSec >= HARD_MIN_TIMEOUT && t.timeoutSec <= HARD_MAX_TIMEOUT, `hard tasks need timeoutSec from ${HARD_MIN_TIMEOUT} to ${HARD_MAX_TIMEOUT}`);
    need(isStr(t.hidden) && fs.existsSync(path.join(HIDDEN_DIR, t.hidden || '?')), 'hard tasks need hidden: a directory under tasks/hidden/');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'tests'), 'hard tasks need at least one tests check');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'fixture_unchanged'), 'hard tasks need a fixture_unchanged check on the existing tests');
    need(!HARD_PROMPT_BANNED.test(t.prompt || ''), 'hard prompt mentions grading, hidden tests, agents, skills or reviewers');
  } else if (real) {
    need(isInt(t.timeoutSec) && t.timeoutSec >= HARD_MIN_TIMEOUT && t.timeoutSec <= HARD_MAX_TIMEOUT, `real tasks need timeoutSec from ${HARD_MIN_TIMEOUT} to ${HARD_MAX_TIMEOUT}`);
    need(isStr(t.real), 'real tasks need real: the id of a manifest entry');
    need(isStr(t.hidden) && t.hidden === t.real && fs.existsSync(path.join(HIDDEN_DIR, t.hidden || '?', 'overlay')), 'real tasks need hidden equal to real, with an overlay/ directory under tasks/hidden/');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'tests' && c.manifest === true), 'real tasks need a tests check with manifest: true');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'fixture_unchanged'), 'real tasks need a fixture_unchanged check on the existing tests');
    need(!HARD_PROMPT_BANNED.test(t.prompt || ''), 'real prompt mentions grading, hidden tests, agents, skills or reviewers');
    need(!REAL_PROMPT_BANNED.test(t.prompt || ''), 'real prompt names a pull request, issue, link or hosting site');
  } else if (autonomy) {
    need(t.real === undefined, 'only real tasks may name a real reference');
    need(isStr(t.hidden) && fs.existsSync(path.join(HIDDEN_DIR, t.hidden || '?')), 'autonomy tasks need hidden: a directory under tasks/hidden/');
    autonomyRules.shapeProblems(t, { hiddenRoot: HIDDEN_DIR }).forEach((p) => err(where, p));
  } else {
    need(t.hidden === undefined && t.real === undefined, 'only hard, real and autonomy tasks may name a hidden directory or a real reference');
  }
  if (Array.isArray(t.tiers) && t.tiers.includes('lite') && isInt(t.timeoutSec)) {
    need(t.timeoutSec <= LITE_MAX_TIMEOUT, `lite tasks need timeoutSec <= ${LITE_MAX_TIMEOUT}`);
  }
  if (isStr(t.fixture)) {
    need(fs.existsSync(path.join(FIXTURES_DIR, t.fixture)), `fixture "${t.fixture}" does not exist`);
  }
  if (!real) need(t.real === undefined, 'only real tasks may name a real reference');
  if (isStr(t.prompt)) {
    need(!PROMPT_BANNED.test(t.prompt), 'prompt names a konductor procedure or agent');
    need(!DASHES.test(t.prompt), 'prompt contains an em or en dash');
    if (!autonomy) need(t.prompt.endsWith(NO_QUESTIONS), 'prompt must end with the no-questions sentence');
    if (FORBIDS_EDITS.test(t.prompt) && Array.isArray(t.checks)) {
      need(t.checks.some((c) => c.type === 'fixture_unchanged'), 'prompt forbids edits but no fixture_unchanged check exists');
    }
  }
  if (Array.isArray(t.checks) && DOC_CLASSES.includes(t.class)) {
    need(t.checks.some((c) => c.type === 'min_matches'), 'document task needs at least one min_matches check');
  }
  (t.checks || []).forEach((c, i) => {
    const at = `${where} checks[${i}]`;
    if (!CHECK_TYPES.includes(c.type)) return err(at, `type must be one of ${CHECK_TYPES.join('|')}`);
    if (c.type !== 'cmd' && c.type !== 'tests' && !isStr(c.path)) err(at, 'path is required');
    if (c.allowAdditions !== undefined && c.type !== 'fixture_unchanged') err(at, 'allowAdditions applies to fixture_unchanged only');
    if (c.manifest !== undefined && (c.type !== 'tests' || c.manifest !== true)) err(at, 'manifest: true applies to tests checks only');
    if (c.type === 'labelled_findings' && !(isInt(c.min) && c.min >= 1)) err(at, 'min must be an integer >= 1');
    if (['contains', 'not_contains', 'min_matches'].includes(c.type)) {
      if (!isStr(c.pattern)) err(at, 'pattern is required');
      else {
        try { new RegExp(c.pattern, PATTERN_FLAGS); } catch (e) { err(at, `invalid pattern: ${e.message}`); }
      }
    }
    if (c.type === 'min_matches' && !(isInt(c.min) && c.min >= 1)) err(at, 'min must be an integer >= 1');
    if (c.type === 'cmd') {
      if (!isStr(c.cmd)) err(at, 'cmd is required');
      if (!isInt(c.expectExit)) err(at, 'expectExit must be an integer');
    }
    if (c.type === 'tests' && c.manifest === true) {
      if (c.cmd !== undefined || c.min !== undefined) err(at, 'a manifest tests check takes its command and counts from the manifest; cmd and min are not allowed');
    } else if (c.type === 'tests') {
      if (!isStr(c.cmd)) err(at, 'cmd is required');
      if (!(isInt(c.min) && c.min >= 1)) err(at, 'min (the known number of hidden tests) must be an integer >= 1');
    }
  });
  const ids = new Set();
  (t.rubric || []).forEach((r, i) => {
    const at = `${where} rubric[${i}]`;
    if (!isStr(r.id)) err(at, 'id is required');
    else if (ids.has(r.id)) err(at, `duplicate rubric id "${r.id}"`);
    else ids.add(r.id);
    if (!isStr(r.criterion)) err(at, 'criterion is required');
    else if (DASHES.test(r.criterion)) err(at, 'criterion contains an em or en dash');
    if (typeof r.weight !== 'number' || r.weight < 1 || r.weight > 3) err(at, 'weight must be a number from 1 to 3');
  });
}

function validateFixtures(used, hardOnly, autonomyOnly = new Set()) {
  for (const name of fs.readdirSync(FIXTURES_DIR)) {
    const dir = path.join(FIXTURES_DIR, name);
    if (!fs.statSync(dir).isDirectory() || name.startsWith('_')) continue;
    const files = listFiles(dir);
    const visible = files.filter((f) => path.basename(f) !== ANSWER_KEY);
    if (!files.includes(ANSWER_KEY)) err(`fixture ${name}`, `missing ${ANSWER_KEY}`);
    const limit = hardOnly.has(name) ? MAX_HARD_FIXTURE_FILES : autonomyOnly.has(name) ? MAX_AUTONOMY_FIXTURE_FILES : MAX_FIXTURE_FILES;
    if (visible.length > limit) err(`fixture ${name}`, `${visible.length} files, limit ${limit}`);
    if (hardOnly.has(name) && visible.length < MAX_FIXTURE_FILES) err(`fixture ${name}`, `${visible.length} files, hard fixtures need at least ${MAX_FIXTURE_FILES}`);
    if (autonomyOnly.has(name) && visible.length < MAX_FIXTURE_FILES) err(`fixture ${name}`, `${visible.length} files, autonomy fixtures need at least ${MAX_FIXTURE_FILES}`);
    if (files.some((f) => f.split(path.sep).includes('.git') || f.split(path.sep).includes('node_modules'))) {
      err(`fixture ${name}`, 'contains .git or node_modules');
    }
    if (!used.has(name)) warn(`fixture ${name}`, 'not used by any task');
    const baseline = FIXTURE_BASELINE[name];
    if (baseline === undefined) {
      warn(`fixture ${name}`, 'no entry in FIXTURE_BASELINE');
    } else if (baseline) {
      const tmp = copyFixture(name);
      const r = sharedEvalCheck(tmp, { type: 'cmd', cmd: baseline.cmd, expectExit: baseline.exit });
      if (!r.passed) err(`fixture ${name}`, `"${baseline.cmd}": ${r.detail} on the untouched fixture`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function scanHygiene() {
  const roots = [TASKS_DIR, FIXTURES_DIR, SUITES_DIR, path.join(BENCH, 'real'), path.join(BENCH, 'README-tasks.md')];
  const self = path.resolve(__filename);
  // Upstream test files and licenses are copied unchanged from other projects; they are not ours to restyle.
  const vendored = (p) => /[\\/]tasks[\\/]hidden[\\/][^\\/]+[\\/](overlay[\\/]|LICENSE$)/.test(p);
  const visit = (p) => {
    if (!fs.existsSync(p)) return;
    if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).forEach((n) => visit(path.join(p, n)));
    if (path.resolve(p) === self || p.endsWith('.gz') || vendored(p)) return;
    const text = fs.readFileSync(p, 'utf8');
    const rel = path.relative(BENCH, p);
    if (INTERNAL_REF.test(text)) err(rel, 'contains an internal reference');
    if (DASHES.test(text) && !p.endsWith('.json')) err(rel, 'contains an em or en dash');
  };
  roots.forEach(visit);
}

// Sum of the hidden-test counts over a task's tests checks, run on `dir` (null when nothing was parsed).
function hiddenScore(t, dir, hiddenDir) {
  let passed = 0;
  let total = 0;
  const started = Date.now();
  for (const c of t.checks.filter((x) => x.type === 'tests')) {
    const r = evalCheck(dir, c, fixtureDir(t.fixture), hiddenDir);
    if (!r.tests || r.tests.unparsed) return { passed: 0, total: r.tests?.total ?? 0, unparsed: true, seconds: (Date.now() - started) / 1000 };
    passed += r.tests.passed;
    total += r.tests.total;
  }
  return { passed, total, unparsed: false, seconds: (Date.now() - started) / 1000 };
}

// Evidence that the hidden tests discriminate: reference all-pass (twice, same counts, fast), untouched
// fixture failing at least 30 percent, and partial solutions strictly between 0 and 100 percent.
function validateHard(t, solutionDir, hiddenDir) {
  const where = t.id;
  const known = t.checks.filter((c) => c.type === 'tests').reduce((n, c) => n + (c.min || 0), 0);
  const solved = copyFixture(t.fixture, solutionDir);
  const first = hiddenScore(t, solved, hiddenDir);
  const second = hiddenScore(t, solved, hiddenDir);
  fs.rmSync(solved, { recursive: true, force: true });
  if (first.unparsed || first.passed !== first.total) err(where, `reference solution passes ${first.passed}/${first.total} hidden tests, expected all`);
  if (first.total !== known) err(where, `tests checks declare min ${known} but the reference run has ${first.total} hidden tests`);
  if (first.passed !== second.passed || first.total !== second.total) err(where, `hidden tests are not deterministic (${first.passed}/${first.total} then ${second.passed}/${second.total})`);
  if (first.seconds + second.seconds > 2 * HIDDEN_MAX_SECONDS || first.seconds >= HIDDEN_MAX_SECONDS) err(where, `hidden tests took ${first.seconds.toFixed(1)} s, limit ${HIDDEN_MAX_SECONDS} s`);

  const bare = copyFixture(t.fixture);
  const base = hiddenScore(t, bare, hiddenDir);
  fs.rmSync(bare, { recursive: true, force: true });
  if (base.unparsed) err(where, 'the untouched fixture gives no readable hidden test result');
  else if (base.passed / base.total > HARD_MAX_FIXTURE_PASS) err(where, `untouched fixture passes ${base.passed}/${base.total} hidden tests, must fail at least 30 percent`);

  const dir = path.join(PARTIALS_DIR, t.id);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort() : [];
  if (names.length < MIN_PARTIALS) err(where, `needs at least ${MIN_PARTIALS} partial solutions under tasks/partials/${t.id}/, found ${names.length}`);
  const partials = [];
  for (const name of names) {
    const work = copyFixture(t.fixture, path.join(dir, name));
    const score = hiddenScore(t, work, hiddenDir);
    fs.rmSync(work, { recursive: true, force: true });
    partials.push({ name, ...score });
    if (score.unparsed || score.passed <= 0 || score.passed >= score.total) err(where, `partial "${name}" scores ${score.passed}/${score.total}, must be strictly between 0 and 100 percent`);
  }
  const counts = [base.passed, ...partials.map((p) => p.passed)];
  if (new Set(counts).size !== counts.length) err(where, `partial solutions and the untouched fixture are not distinct (passed counts ${counts.join(', ')})`);
  return `${t.id}: reference ${first.passed}/${first.total} in ${first.seconds.toFixed(1)}s, fixture ${base.passed}/${base.total}, partials ${partials.map((p) => `${p.name} ${p.passed}/${p.total}`).join(', ')}`;
}


// Scores of the intended and invariant tests checks of an autonomy task on one tree.
function groupScores(t, dir, hiddenDir) {
  const out = { intended: { passed: 0, total: 0 }, invariant: { passed: 0, total: 0 }, seconds: 0 };
  const started = Date.now();
  for (const c of t.checks.filter((x) => x.type === 'tests')) {
    const r = evalCheck(dir, c, fixtureDir(t.fixture), hiddenDir);
    const g = out[c.group];
    if (!r.tests || r.tests.unparsed) { g.unparsed = true; continue; }
    g.passed += r.tests.passed;
    g.total += r.tests.total;
  }
  out.seconds = (Date.now() - started) / 1000;
  return out;
}

// Evidence that the hidden tests tell the intended reading from a wrong one: the reference passes every intended
// and invariant test, the untouched fixture fails intended tests, and each partial fails at least one intended test
// while passing every invariant. Also runs the reference twice (determinism) and times it.
function validateAutonomyEvidence(t, solutionDir, hiddenDir) {
  const solved = copyFixture(t.fixture, solutionDir);
  const reference = groupScores(t, solved, hiddenDir);
  const again = groupScores(t, solved, hiddenDir);
  fs.rmSync(solved, { recursive: true, force: true });
  const bare = copyFixture(t.fixture);
  const fixture = groupScores(t, bare, hiddenDir);
  fs.rmSync(bare, { recursive: true, force: true });
  const dir = path.join(PARTIALS_DIR, t.id);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort() : [];
  const partials = names.map((name) => {
    const work = copyFixture(t.fixture, path.join(dir, name));
    const score = groupScores(t, work, hiddenDir);
    fs.rmSync(work, { recursive: true, force: true });
    return { name, intended: score.intended, invariant: score.invariant };
  });
  autonomyRules.evidenceProblems(t, { reference, again, fixture, partials }).forEach((p) => err(t.id, p));
  const f = (s) => `${s.passed}/${s.total}`;
  return `${t.id}: reference ${f(reference.intended)} intended + ${f(reference.invariant)} invariants in ${reference.seconds.toFixed(1)}s, fixture ${f(fixture.intended)} intended, partials ${partials.map((p) => `${p.name} ${f(p.intended)} intended / ${f(p.invariant)} invariants`).join(', ')}; ${(t.autonomy.clarifications || []).length} clarification(s)${t.autonomy.noQuestionNeeded ? ', no question needed' : ''}`;
}

// Source files of a fix, without tests, docs and change logs.
const isSourcePath = (f) => /\.(py|js|mjs|cjs|ts|rs|go|java)$/.test(f) && !reallib.isTestPath(f) && !/^docs?\//.test(f);

// Offline checks of a real task against the manifest and the vendored files. Returns a one-line summary.
function validateRealTask(t, manifest) {
  const where = t.id;
  const entry = manifest.tasks.find((e) => e.id === t.real);
  if (!entry) { err(where, `no manifest entry "${t.real}" in real/manifest.json (an entry that was dropped cannot be used)`); return `${t.id}: no manifest entry`; }
  if (t.id !== `real-${entry.id}`) err(where, `id must be real-${entry.id}`);
  if (!entry.validation) err(where, 'the manifest entry has no validation record; run node bench/real/validate-real.js --write');
  if (!ALLOWED_REAL_LICENSES.has(entry.repo.license)) err(where, `license ${entry.repo.license} is not permissive`);
  if (!(entry.sourceFiles.all >= 50 && entry.sourceFiles.all <= 400)) err(where, `${entry.sourceFiles.all} source files, need 50 to 400`);
  if (!/^20(2[5-9]|[3-9]\d)-/.test(entry.pr.mergedAt)) err(where, `merged ${entry.pr.mergedAt.slice(0, 10)}, before 2025`);
  if (!entry.failToPass.length) err(where, 'the manifest entry has no FAIL_TO_PASS tests');
  try {
    const p2p = reallib.loadP2p(entry, path.join(BENCH, 'real', 'p2p'));
    if (!p2p.length) err(where, 'the manifest entry has no PASS_TO_PASS tests');
  } catch (e) { err(where, e.message); }
  if (!(entry.test.timeoutSec <= 120)) err(where, 'the test command may take at most 120 s');
  if (!(entry.test.probeModules || []).length) err(where, 'test.probeModules is empty');
  for (const x of entry.excluded || []) if (!isStr(x.reason)) err(where, `excluded test ${x.id} has no reason`);
  const dir = path.join(HIDDEN_DIR, entry.id);
  const overlay = path.join(dir, 'overlay');
  const files = fs.existsSync(overlay) ? listFiles(overlay).map((f) => f.split(path.sep).join('/')).sort() : [];
  if (files.join('\n') !== [...entry.testFiles].sort().join('\n')) err(where, `vendored test files (${files.join(', ')}) differ from the manifest (${entry.testFiles.join(', ')})`);
  for (const f of ['LICENSE', 'NOTICE']) if (!fs.existsSync(path.join(dir, f))) err(where, `missing ${f} in tasks/hidden/${entry.id}/`);
  for (const c of (t.checks || []).filter((x) => x.type === 'fixture_unchanged')) {
    if (!entry.testFiles.some((f) => f === c.path || f.startsWith(`${c.path}/`))) err(where, `fixture_unchanged path "${c.path}" does not cover any test file of the task`);
  }
  const notice = fs.existsSync(REAL_NOTICE) ? fs.readFileSync(REAL_NOTICE, 'utf8') : '';
  for (const need of [entry.repo.name, entry.repo.license, entry.repo.url]) if (!notice.includes(need)) err(where, `real/NOTICE does not list ${need}`);
  return `${t.id}: ${entry.kind}, ${entry.repo.name} ${entry.repo.license}, ${entry.failToPass.length} FAIL_TO_PASS, ${entry.passToPass.count ?? entry.passToPass.length} PASS_TO_PASS`;
}

// The real set: 6 to 8 validated tasks, at least 3 bug fixes that span several source files and 2 small features.
function validateRealSet(tasks, manifest) {
  const at = 'real tasks';
  const entries = tasks.filter((t) => t.class === 'real').map((t) => manifest.tasks.find((e) => e.id === t.real)).filter(Boolean);
  if (entries.length < REAL_MIN_TASKS || entries.length > REAL_MAX_TASKS) err(at, `${entries.length} tasks, need ${REAL_MIN_TASKS} to ${REAL_MAX_TASKS}`);
  const crossFile = entries.filter((e) => e.kind === 'bug' && e.fixFiles.filter(isSourcePath).length >= 2).length;
  const features = entries.filter((e) => e.kind === 'feature').length;
  if (crossFile < REAL_MIN_CROSS_FILE_BUGS) err(at, `${crossFile} bug fixes span two or more source files, need ${REAL_MIN_CROSS_FILE_BUGS}`);
  if (features < REAL_MIN_FEATURES) err(at, `${features} features, need ${REAL_MIN_FEATURES}`);
  return `real set: ${entries.length} tasks, ${crossFile} cross-file bug fixes, ${features} features, languages ${[...new Set(entries.map((e) => e.language))].join('+')}`;
}

function main() {
  const taskFiles = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const tasks = [];
  const seen = new Map();
  for (const f of taskFiles) {
    const t = readJson(path.join(TASKS_DIR, f), f);
    if (!t) continue;
    validateShape(f, t);
    if (seen.has(t.id)) err(f, `duplicate id "${t.id}" (also ${seen.get(t.id)})`);
    seen.set(t.id, f);
    tasks.push(t);
  }

  const manifestFile = path.join(BENCH, 'real', 'manifest.json');
  const manifest = tasks.some((t) => t.class === 'real') ? readJson(manifestFile, 'real/manifest.json') : null;
  const used = new Set(tasks.map((t) => t.fixture).filter(isStr));
  const hardOnly = new Set([...used].filter((f) => tasks.filter((t) => t.fixture === f).every((t) => t.class === 'hard')));
  const autonomyOnly = new Set([...used].filter((f) => tasks.filter((t) => t.fixture === f).every((t) => t.class === 'autonomy')));
  validateFixtures(used, hardOnly, autonomyOnly);

  let guards = 0;
  let negativeCases = 0;
  const stubReport = [];
  const hardReport = [];
  const autonomyReport = [];
  const realReport = [];
  for (const t of tasks) {
    if (t.class === 'real' && manifest && Array.isArray(t.checks)) { realReport.push(validateRealTask(t, manifest)); continue; }
    if (!isStr(t.fixture) || !fs.existsSync(path.join(FIXTURES_DIR, t.fixture)) || !Array.isArray(t.checks)) continue;
    const where = t.id;
    const hiddenDir = t.hidden ? path.join(HIDDEN_DIR, t.hidden) : null;
    const pristine = copyFixture(t.fixture);
    const results = t.checks.map((c) => ({ c, r: evalCheck(pristine, c, fixtureDir(t.fixture), hiddenDir) }));
    fs.rmSync(pristine, { recursive: true, force: true });
    results.forEach(({ c, r }, i) => {
      if (r.broken) err(where, `checks[${i}] is broken on the untouched fixture (${r.detail})`);
      if (r.pass) guards += 1;
    });
    if (results.every(({ r }) => r.pass)) err(where, 'every check already passes on the untouched fixture');

    const overlay = path.join(SOLUTIONS_DIR, t.id);
    if (!fs.existsSync(overlay)) {
      err(where, `missing reference solution at tasks/solutions/${t.id}/`);
      continue;
    }
    const solved = copyFixture(t.fixture, overlay);
    t.checks.forEach((c, i) => {
      const r = evalCheck(solved, c, fixtureDir(t.fixture), hiddenDir);
      if (!r.pass) err(where, `checks[${i}] (${c.type}${c.path ? ' ' + c.path : ''}) fails on the reference solution: ${r.detail}`);
    });
    fs.rmSync(solved, { recursive: true, force: true });
    if (t.class === 'hard') hardReport.push(validateHard(t, overlay, hiddenDir));
    if (t.class === 'autonomy') autonomyReport.push(validateAutonomyEvidence(t, overlay, hiddenDir));

    const spec = loadCases(NEGATIVES_DIR, t.id);
    if (spec) {
      checkCases({
        task: t, spec,
        makeWorkspace: () => copyFixture(t.fixture, overlay),
        evalOne: (dir, c) => evalCheck(dir, c, fixtureDir(t.fixture)).pass,
      }).forEach((p) => err(where, p));
      negativeCases += spec.cases.length;
    }

    const stub = path.join(STUBS_DIR, t.id);
    if (!fs.existsSync(stub)) {
      if (DOC_CLASSES.includes(t.class)) err(where, `missing keyword stub at tasks/stubs/${t.id}/`);
      continue;
    }
    const stubbed = copyFixture(t.fixture, overlay);
    fs.cpSync(stub, stubbed, { recursive: true });
    const failed = t.checks
      .map((c) => ({ c, r: evalCheck(stubbed, c, fixtureDir(t.fixture)) }))
      .filter(({ r }) => !r.pass);
    fs.rmSync(stubbed, { recursive: true, force: true });
    if (failed.length === 0) err(where, 'the keyword-only stub passes every check');
    else if (!failed.some(({ c }) => c.type === 'min_matches' || c.type === 'cmd' || c.type === 'labelled_findings')) {
      err(where, 'the keyword-only stub fails only keyword checks (no min_matches or cmd check caught it)');
    }
    stubReport.push(`${t.id} ${failed.length}/${t.checks.length}`);
  }

  for (const t of tasks) {
    if (!Array.isArray(t.checks)) continue;
    t.checks.forEach((c, i) => {
      if (c.type === 'contains' && /verdict|needs fixes|not ready|ready for (cr|release)/i.test(c.pattern || '') && new RegExp(c.pattern, PATTERN_FLAGS).test(VERDICT_LISTING)) {
        err(t.id, `checks[${i}] matches a bare list of verdict words; match a verdict line`);
      }
    });
  }

  const suites = {};
  if (manifest) realReport.push(validateRealSet(tasks, manifest));
  for (const name of ['lite', 'full', 'hard', 'real', 'autonomy', 'pilot']) {
    const file = path.join(SUITES_DIR, `${name}.json`);
    const s = fs.existsSync(file) ? readJson(file, `suites/${name}.json`) : null;
    if (!s) { err(`suites/${name}.json`, 'missing or unreadable'); continue; }
    suites[name] = s;
    const at = `suites/${name}.json`;
    if (!Array.isArray(s.tasks) || s.tasks.length === 0) err(at, 'tasks must be a non-empty array');
    else {
      if (new Set(s.tasks).size !== s.tasks.length) err(at, 'tasks has duplicates');
      for (const id of s.tasks) {
        if (!seen.has(id)) err(at, `unknown task id "${id}"`);
      }
    }
    if (!Array.isArray(s.arms) || !s.arms.every(isStr) || s.arms.length === 0) err(at, 'arms must be a non-empty string array');
    if (!isInt(s.replicates) || s.replicates < 1) err(at, 'replicates must be a positive integer');
    if (!Array.isArray(s.judges) || !s.judges.every(isStr) || s.judges.length < MIN_JUDGES) {
      err(at, `judges must be a string array with at least ${MIN_JUDGES} models`);
    } else {
      try { checkPanel(s.judges); } catch (e) { err(at, e.message); }
      for (const j of s.judges) {
        try { checkJudgeModel(j, SUBJECT_MODEL); } catch (e) { err(at, e.message); }
      }
    }
  }
  for (const [name, s] of Object.entries(suites)) {
    if (!Array.isArray(s.tasks)) continue;
    const expected = tasks.filter((t) => Array.isArray(t.tiers) && t.tiers.includes(name)).map((t) => t.id).sort();
    const actual = [...s.tasks].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      err(`suites/${name}.json`, `tasks do not match the tasks tagged "${name}" (tagged: ${expected.join(', ')})`);
    }
  }
  if (suites.lite && Array.isArray(suites.lite.tasks)) {
    const at = 'suites/lite.json';
    if (suites.lite.tasks.length !== LITE_TASKS) err(at, `expected ${LITE_TASKS} tasks, found ${suites.lite.tasks.length}`);
    const lite = suites.lite.tasks.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
    const fixtures = new Set(lite.map((t) => t.fixture));
    const classes = new Set(lite.map((t) => t.class));
    if (fixtures.size < LITE_MIN_FIXTURES) err(at, `tasks cover ${fixtures.size} fixtures, need at least ${LITE_MIN_FIXTURES}`);
    if (classes.size < LITE_MIN_CLASSES) err(at, `tasks cover ${classes.size} classes, need at least ${LITE_MIN_CLASSES}`);
    if (suites.lite.parallel !== 1) err(at, 'parallel must be 1 (wall-clock comparisons need one run at a time)');
  }

  if (suites.real) {
    if (suites.real.parallel !== 1) err('suites/real.json', 'parallel must be 1 (wall-clock comparisons need one run at a time)');
    for (const id of suites.real.tasks || []) {
      const t = tasks.find((x) => x.id === id);
      if (t && t.class !== 'real') err('suites/real.json', `task "${id}" is not a real task`);
    }
  }

  if (suites.autonomy) {
    if (suites.autonomy.parallel !== 1) err('suites/autonomy.json', 'parallel must be 1 (wall-clock comparisons need one run at a time)');
    for (const id of suites.autonomy.tasks || []) {
      const t = tasks.find((x) => x.id === id);
      if (t && t.class !== 'autonomy') err('suites/autonomy.json', `task "${id}" is not an autonomy task`);
    }
  }

  if (suites.pilot && suites.pilot.parallel !== 1) err('suites/pilot.json', 'parallel must be 1 (wall-clock comparisons need one run at a time)');

  if (suites.hard) {
    if (suites.hard.parallel !== 1) err('suites/hard.json', 'parallel must be 1 (wall-clock comparisons need one run at a time)');
    for (const id of suites.hard.tasks || []) {
      const t = tasks.find((x) => x.id === id);
      if (t && t.class !== 'hard') err('suites/hard.json', `task "${id}" is not a hard task`);
    }
  }

  scanHygiene();

  const byClass = {};
  for (const t of tasks) byClass[t.class] = (byClass[t.class] || 0) + 1;
  console.log(`tasks: ${tasks.length} ${JSON.stringify(byClass)}`);
  console.log(`checks passing on untouched fixtures (regression guards): ${guards}`);
  console.log(`keyword-only stubs (failing checks / total): ${stubReport.join(', ')}`);
  console.log(`negative and positive cases for loosened checks: ${negativeCases}`);
  hardReport.forEach((h) => console.log(`hard ${h}`));
  autonomyReport.forEach((a) => console.log(`autonomy ${a}`));
  realReport.forEach((r) => console.log(`real ${r}`));
  for (const [name, s] of Object.entries(suites)) {
    if (Array.isArray(s.judges)) console.log(`suite ${name}: judges ${s.judges.join(', ')}; tasks ${s.tasks.length}`);
  }
  warnings.forEach((w) => console.log(`warning: ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`error: ${e}`));
    console.error(`FAILED with ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('OK');
}

main();
