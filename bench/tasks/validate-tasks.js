#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Offline validator for bench/tasks, bench/fixtures and bench/suites.
// Usage: node bench/tasks/validate-tasks.js
//
// For every task it checks the schema shape, then runs the task's checks twice
// in a throwaway copy of the fixture:
//   1. untouched fixture: at least one check must fail (the task cannot pass
//      by doing nothing), and no cmd check may be broken (exit 127, SyntaxError).
//   2. fixture plus tasks/solutions/<id>/ overlay: every check must pass.
//   3. negative controls (tasks/controls.js): no check may pass on an empty workspace; a file the solution provides
//      whose deletion leaves every check green is reported as a warning.
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
// Complex tasks (class "complex", directory bench/complex) get the same hidden-test and partial-solution proofs as hard
// tasks, with a timeout up to 3600 s, a fixture of up to 40 files and no minimum fixture size.
// Check semantics live in runner/lib/check-matcher.js, shared with the runner.
// Suite judges are validated with the family rules from judge/config.js.
// Files starting with "_" in bench/tasks (for example the runner smoke task)
// are skipped.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck: sharedEvalCheck, CHECK_TYPES, PATTERN_FLAGS, ANSWER_KEY } = require('../runner/lib/check-matcher.js');
const { defaultCheckTypes, pluginShapeErrors } = require('../runner/lib/check-types.js');
const { checkPanel, checkJudgeModel } = require('../judge/config.js');
const { loadCases, checkCases } = require('../runner/lib/negatives.js');
const reallib = require('../real/lib.js');
const autonomyRules = require('./validate-autonomy.js');
const { loadRegistry, validateRegistry } = require('../cap/registry.js');
const { scanRepo, loadAgentSpecs } = require('../cap/scan.js');
const controls = require('./controls.js');
const toolchain = require('../runner/lib/toolchain.js');
const { suiteExtraDirs } = require('../runner/lib/tasks.js');
const { v3Errors } = require('../runner/lib/task-v3.js');
const { loadPack, patternKeyProblems, declaredArtifacts } = require('../judge/pack/index.js');

const BENCH = path.resolve(__dirname, '..');
const TASKS_DIR = path.join(BENCH, 'tasks');
const FIXTURES_DIR = path.join(BENCH, 'fixtures');
const SUITES_DIR = path.join(BENCH, 'suites');
const SOLUTIONS_DIR = path.join(TASKS_DIR, 'solutions');
const STUBS_DIR = path.join(TASKS_DIR, 'stubs');
const NEGATIVES_DIR = path.join(TASKS_DIR, 'negatives');
const HIDDEN_DIR = path.join(TASKS_DIR, 'hidden');
const PARTIALS_DIR = path.join(TASKS_DIR, 'partials');

// Where the task under validation keeps its fixtures, solutions, hidden tests and so on. The bench tasks use the
// directories above; a task from --extra-tasks DIR uses DIR/fixtures (then the bench fixtures), DIR/solutions and so on.
const DEFAULT_ROOTS = { fixtures: [FIXTURES_DIR], solutions: SOLUTIONS_DIR, stubs: STUBS_DIR, negatives: NEGATIVES_DIR, hidden: HIDDEN_DIR, partials: PARTIALS_DIR, extra: false };
const extraRoots = (dir) => ({
  fixtures: [path.join(dir, 'fixtures'), FIXTURES_DIR], solutions: path.join(dir, 'solutions'), stubs: path.join(dir, 'stubs'),
  negatives: path.join(dir, 'negatives'), hidden: path.join(dir, 'hidden'), partials: path.join(dir, 'partials'), extra: true, dir,
});
let R = DEFAULT_ROOTS;

const CLASSES = ['simple', 'sop', 'orchestration', 'review', 'design', 'hard', 'complex', 'real', 'autonomy', 'trigger'];
const TIERS = ['lite', 'full', 'hard', 'real', 'autonomy', 'requirements', 'pilot', 'cap'];
const REAL_RUBRIC_SIZE = 3;
const REAL_MIN_TASKS = 6;
const REAL_MAX_TASKS = 8;
const REAL_MIN_CROSS_FILE_BUGS = 3;
const REAL_MIN_FEATURES = 2;
const ALLOWED_REAL_LICENSES = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC']);
const REAL_NOTICE = path.join(BENCH, 'real', 'NOTICE');
const MAX_FIXTURE_FILES = 15;
// Fixtures used only by hard tasks may be larger; so may fixtures used only by complex tasks (a ported program with its sources and data), with no minimum.
const MAX_HARD_FIXTURE_FILES = 40;
// Fixtures used only by autonomy tasks: 15 to 30 files.
const MAX_AUTONOMY_FIXTURE_FILES = 30;
const HARD_MIN_TIMEOUT = 900;
const HARD_MAX_TIMEOUT = 1500;
const COMPLEX_MAX_TIMEOUT = 3600;
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
  // Neutral fixture of the trigger tasks that `cap trigger` writes: no tests to run.
  'trigger-neutral': null,
  // Hard fixtures: the visible tests pass before and after the work, so they cannot hide the defects.
  'hard-quota': { cmd: 'node --test', exit: 0 },
  'hard-jobs': { cmd: 'node --test', exit: 0 },
  'hard-invoice': { cmd: 'node --test', exit: 0 },
  'hard-contacts': { cmd: 'node --test', exit: 0 },
  'hard-migrate': { cmd: 'node --test', exit: 0 },
  'hard-billing': { cmd: 'node --test', exit: 0 },
  // Hard fixtures for the code-quality criteria (concurrency, extension, targets in code): same rule.
  'hard-seats': { cmd: 'node --test', exit: 0 },
  'hard-exports': { cmd: 'node --test', exit: 0 },
  'hard-catalog': { cmd: 'node --test', exit: 0 },
  // SDLC-suite fixtures (bench/sdlc): two hold only documents and data, two have tests that pass before and after.
  'sd-feedback': null,
  'sd-notify': null,
  'sd-dedupe': { cmd: 'node --test', exit: 0 },
  'sd-worker': { cmd: 'node --test', exit: 0 },
  // Review fixtures: the change, design or review to check; the code ones have tests that pass before and after.
  'sd-review-diff': { cmd: 'node --test', exit: 0 },
  'sd-review-audit': { cmd: 'node --test', exit: 0 },
  'sd-design-doc': null,
  // Autonomy fixtures: the visible tests pass before and after the work.
  'auto-gateway': { cmd: 'node --test', exit: 0 },
  'auto-reports': { cmd: 'node --test', exit: 0 },
  'auto-crm': { cmd: 'node --test', exit: 0 },
  'auto-league': { cmd: 'node --test', exit: 0 },
  'auto-units': { cmd: 'node --test', exit: 0 },
  'auto-storage': { cmd: 'node --test', exit: 0 },
  // Complex-suite fixtures: the visible tests pass before and after the work.
  'cx-holds': { cmd: 'node --test', exit: 0 },
  'cx-shipping': { cmd: 'node --test', exit: 0 },
  // No tests in the fixture: the work is a port from COBOL.
  'cx-carddemo': null,
  'cx-notes': { cmd: 'node --test', exit: 0 },
  'cx-ledger': { cmd: 'node --test', exit: 0 },
  // Requirements-suite fixtures: a copy of the inventory service and one request document; the tests pass before and after.
  'req-inventory': { cmd: 'node --test', exit: 0 },
  'plan-inventory': { cmd: 'node --test', exit: 0 },
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

const fixtureDir = (name) => R.fixtures.map((d) => path.join(d, name)).find((d) => fs.existsSync(d)) ?? path.join(R.fixtures[0], name);

function copyFixture(name, overlayDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-validate-'));
  fs.cpSync(fixtureDir(name), tmp, {
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

// A trigger task is a query run to see which capability the agent reaches for. It has no checks, rubric or hidden tests,
// is not a document task, and does not end with the no-questions sentence; its prompt may be short.
const TRIGGER_PROMPT_MAX = 600;
// Imported tasks keep every expectation of the source data as a rubric item, so they may exceed the 6 of a hand-written task.
const IMPORT_RUBRIC_MAX = 16;
function validateTriggerShape(file, t) {
  const where = path.basename(file);
  const need = (cond, msg) => { if (!cond) err(where, msg); };
  need(isStr(t.id), 'id must be a non-empty string');
  need(where === `${t.id}.json`, `file name must be <id>.json (id is "${t.id}")`);
  need(R.extra, 'trigger tasks live in an --extra-tasks directory, not in bench/tasks');
  need(t.target === undefined || t.target === null || isStr(t.target), 'target must be a string or null');
  for (const e of v3Errors(t)) err(where, e);
  need(isStr(t.prompt) && t.prompt.length <= TRIGGER_PROMPT_MAX, `prompt must be 1 to ${TRIGGER_PROMPT_MAX} characters`);
  need(isStr(t.fixture) && fs.existsSync(fixtureDir(t.fixture)), `fixture "${t.fixture}" does not exist`);
  need(isInt(t.timeoutSec) && t.timeoutSec > 0, 'timeoutSec must be a positive integer');
  need(Array.isArray(t.checks) && t.checks.length === 0, 'trigger tasks have no checks');
  need(Array.isArray(t.rubric) && t.rubric.length === 0, 'trigger tasks have no rubric');
  need(t.hidden === undefined && t.real === undefined, 'trigger tasks have no hidden directory or real reference');
  need(Array.isArray(t.tiers) && t.tiers.length === 1 && t.tiers[0] === 'cap', 'trigger tasks must have tiers ["cap"]');
  need(t.triggerQuery && isStr(t.triggerQuery.capId) && isStr(t.triggerQuery.queryId) && ['load', 'none'].includes(t.triggerQuery.expect), 'trigger tasks need a triggerQuery with capId, queryId and expect (load or none)');
  if (isStr(t.prompt)) {
    need(!PROMPT_BANNED.test(t.prompt), 'prompt names a konductor procedure or agent');
    need(!DASHES.test(t.prompt), 'prompt contains an em or en dash');
  }
}

function validateShape(file, t, textOnly = false, rubricMax = 6) {
  if (t.class === 'trigger') return validateTriggerShape(file, t);
  const where = path.basename(file);
  const need = (cond, msg) => { if (!cond) err(where, msg); };
  need(isStr(t.id), 'id must be a non-empty string');
  need(where === `${t.id}.json`, `file name must be <id>.json (id is "${t.id}")`);
  need(CLASSES.includes(t.class), `class must be one of ${CLASSES.join('|')}`);
  need(t.target === undefined || t.target === null || isStr(t.target), 'target must be a string or null');
  for (const e of v3Errors(t)) err(where, e);
  need(isStr(t.prompt), 'prompt must be a non-empty string');
  const real = t.class === 'real';
  if (real) need(t.fixture === undefined, 'real tasks have no fixture; the base tree comes from the real-repository cache');
  else need(isStr(t.fixture), 'fixture must be a non-empty string');
  need(isInt(t.timeoutSec) && t.timeoutSec > 0, 'timeoutSec must be a positive integer');
  need(Array.isArray(t.checks) && (textOnly || t.checks.length > 0), 'checks must be a non-empty array');
  need(Array.isArray(t.rubric) && t.rubric.length >= 3 && t.rubric.length <= rubricMax, `rubric must have 3 to ${rubricMax} entries`);
  if (real) need(Array.isArray(t.rubric) && t.rubric.length === REAL_RUBRIC_SIZE, `real tasks need exactly ${REAL_RUBRIC_SIZE} rubric criteria`);
  need(Array.isArray(t.tiers) && t.tiers.length > 0 && t.tiers.every((x) => TIERS.includes(x)), `tiers must be a non-empty subset of ${TIERS.join('|')}`);
  const hard = t.class === 'hard';
  const complex = t.class === 'complex';
  const autonomy = t.class === 'autonomy' || t.autonomy !== undefined;
  // "pilot" is added on top of a task's own tier; the rules below look at the tiers without it.
  const ownTiers = Array.isArray(t.tiers) ? t.tiers.filter((x) => x !== 'pilot') : [];
  if (Array.isArray(t.tiers)) {
    if (autonomy) { /* tiers are checked with the other autonomy rules */ }
    else if (hard && !R.extra) need(ownTiers.length === 1 && ownTiers[0] === 'hard', 'hard tasks must have tiers ["hard"] (and optionally "pilot") only');
    else if (real) need(ownTiers.length === 1 && ownTiers[0] === 'real', 'real tasks must have tiers ["real"] (and optionally "pilot") only; the full tier does not include them');
    else if (R.extra) need(!t.tiers.includes('hard') && !t.tiers.includes('real'), 'an extra task may not be tagged hard or real (those tiers are the bench suites)');
    else if (ownTiers.includes('requirements')) need(ownTiers.length === 1, 'requirements tasks must have tiers ["requirements"] (and optionally "pilot") only; the full tier does not include them');
    else need(t.tiers.includes('full') && !t.tiers.includes('hard') && !t.tiers.includes('real'), 'every task must include the full tier (and only hard tasks the hard tier, only real tasks the real tier)');
  }
  if (hard) {
    need(isInt(t.timeoutSec) && t.timeoutSec >= HARD_MIN_TIMEOUT && t.timeoutSec <= HARD_MAX_TIMEOUT, `hard tasks need timeoutSec from ${HARD_MIN_TIMEOUT} to ${HARD_MAX_TIMEOUT}`);
    need(isStr(t.hidden) && fs.existsSync(path.join(R.hidden, t.hidden || '?')), 'hard tasks need hidden: a directory under tasks/hidden/');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'tests'), 'hard tasks need at least one tests check');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'fixture_unchanged'), 'hard tasks need a fixture_unchanged check on the existing tests');
    need(!HARD_PROMPT_BANNED.test(t.prompt || ''), 'hard prompt mentions grading, hidden tests, agents, skills or reviewers');
  } else if (complex) {
    need(R.extra, 'complex tasks live in an --extra-tasks directory (bench/complex), not in bench/tasks');
    need(isInt(t.timeoutSec) && t.timeoutSec >= HARD_MIN_TIMEOUT && t.timeoutSec <= COMPLEX_MAX_TIMEOUT, `complex tasks need timeoutSec from ${HARD_MIN_TIMEOUT} to ${COMPLEX_MAX_TIMEOUT}`);
    need(isStr(t.hidden) && fs.existsSync(path.join(R.hidden, t.hidden || '?')), 'complex tasks need hidden: a directory under hidden/');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'tests'), 'complex tasks need at least one tests check');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'fixture_unchanged'), 'complex tasks need a fixture_unchanged check on the existing tests');
    need(!HARD_PROMPT_BANNED.test(t.prompt || ''), 'complex prompt mentions grading, hidden tests, agents, skills or reviewers');
  } else if (real) {
    need(isInt(t.timeoutSec) && t.timeoutSec >= HARD_MIN_TIMEOUT && t.timeoutSec <= HARD_MAX_TIMEOUT, `real tasks need timeoutSec from ${HARD_MIN_TIMEOUT} to ${HARD_MAX_TIMEOUT}`);
    need(isStr(t.real), 'real tasks need real: the id of a manifest entry');
    need(isStr(t.hidden) && t.hidden === t.real && fs.existsSync(path.join(R.hidden, t.hidden || '?', 'overlay')), 'real tasks need hidden equal to real, with an overlay/ directory under tasks/hidden/');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'tests' && c.manifest === true), 'real tasks need a tests check with manifest: true');
    need(Array.isArray(t.checks) && t.checks.some((c) => c.type === 'fixture_unchanged'), 'real tasks need a fixture_unchanged check on the existing tests');
    need(!HARD_PROMPT_BANNED.test(t.prompt || ''), 'real prompt mentions grading, hidden tests, agents, skills or reviewers');
    need(!REAL_PROMPT_BANNED.test(t.prompt || ''), 'real prompt names a pull request, issue, link or hosting site');
  } else if (autonomy) {
    need(t.real === undefined, 'only real tasks may name a real reference');
    need(isStr(t.hidden) && fs.existsSync(path.join(R.hidden, t.hidden || '?')), 'autonomy tasks need hidden: a directory under tasks/hidden/');
    autonomyRules.shapeProblems(t, { hiddenRoot: R.hidden }).forEach((p) => err(where, p));
  } else {
    need(t.hidden === undefined && t.real === undefined, 'only hard, complex, real and autonomy tasks may name a hidden directory or a real reference');
  }
  if (Array.isArray(t.tiers) && t.tiers.includes('lite') && isInt(t.timeoutSec)) {
    need(t.timeoutSec <= LITE_MAX_TIMEOUT, `lite tasks need timeoutSec <= ${LITE_MAX_TIMEOUT}`);
  }
  if (isStr(t.fixture)) {
    need(fs.existsSync(fixtureDir(t.fixture)), `fixture "${t.fixture}" does not exist`);
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
    const plugin = CHECK_TYPES.includes(c.type) ? null : defaultCheckTypes().plugin(c.type);
    if (!CHECK_TYPES.includes(c.type) && !plugin) return err(at, `type must be one of ${defaultCheckTypes().ids().join('|')}`);
    if (plugin) for (const problem of pluginShapeErrors(plugin, c)) err(at, problem);
    if (c.type !== 'cmd' && c.type !== 'tests' && !isStr(c.path)) err(at, 'path is required');
    if (c.weight !== undefined && !(typeof c.weight === 'number' && Number.isFinite(c.weight) && c.weight >= 0)) err(at, 'weight must be a number of 0 or more');
    if (c.kind !== undefined && !['substance', 'format'].includes(c.kind)) err(at, 'kind must be substance or format');
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

function validateFixtures(used, hardOnly, autonomyOnly = new Set(), root = FIXTURES_DIR, imported = false, complexOnly = new Set()) {
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory() || name.startsWith('_')) continue;
    const files = listFiles(dir);
    const visible = files.filter((f) => path.basename(f) !== ANSWER_KEY);
    if (!files.includes(ANSWER_KEY)) err(`fixture ${name}`, `missing ${ANSWER_KEY}`);
    const limit = hardOnly.has(name) || complexOnly.has(name) ? MAX_HARD_FIXTURE_FILES : autonomyOnly.has(name) ? MAX_AUTONOMY_FIXTURE_FILES : MAX_FIXTURE_FILES;
    if (visible.length > limit) (imported ? warn : err)(`fixture ${name}`, `${visible.length} files, limit ${limit}`);
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
  const roots = [TASKS_DIR, FIXTURES_DIR, SUITES_DIR, path.join(BENCH, 'real'), path.join(BENCH, 'docs', 'tasks.md')];
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

  const dir = path.join(R.partials, t.id);
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
  const dir = path.join(R.partials, t.id);
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

// --extra-tasks DIR[,DIR] adds task directories outside bench/tasks; they get the same proofs against their own
// fixtures, solutions, stubs, negatives and hidden tests. Suites list bench tasks only.
function extraDirsFromArgs(argv = process.argv.slice(2)) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--extra-tasks') out.push(...String(argv[++i] ?? '').split(',').filter(Boolean).map((d) => path.resolve(d)));
    else if (argv[i] === '--only-extra') continue;
    else if (argv[i].startsWith('--')) { console.error(`validate-tasks: unknown flag ${argv[i]} (known: --extra-tasks DIR[,DIR], --only-extra)`); process.exit(2); }
  }
  return out;
}

/**
 * Every task to validate: the bench's own tasks (unless `onlyExtra`) and the tasks of each extra dir. v3 scenario tasks
 * (with a `phase`) are skipped here; `scenarios lint` and the batch dry run check them (DEBT D-80).
 * Returns { tasks, seen (id -> file), rootsOf (task -> roots), skillevalDirs, importDirs, skippedV3, v3Dirs }.
 */
function loadAllTasks(onlyExtra, extraDirs) {
  const taskFiles = onlyExtra ? [] : fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const tasks = [];
  const seen = new Map();
  const rootsOf = new Map();
  const sources = [{ dir: TASKS_DIR, files: taskFiles, roots: DEFAULT_ROOTS }];
  // Text-only tasks written by bench/skilleval/skilleval.js: no checks, scored by rubric, so the fixture proofs below do not apply.
  const skillevalDirs = new Set();
  // Tasks written by bench/skilleval/import.js: fixtures and checks like a bench task, but no reference solution, so only the untouched-fixture proof applies.
  const importDirs = new Set();
  for (const dir of extraDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { err('--extra-tasks', `directory not found: ${dir}`); continue; }
    sources.push({ dir, files: fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort(), roots: extraRoots(dir) });
    if (fs.existsSync(path.join(dir, '.skilleval'))) skillevalDirs.add(dir);
    if (fs.existsSync(path.join(dir, '.skilleval-import'))) importDirs.add(dir);
  }
  const skippedV3 = [];
  const v3Dirs = new Set();
  for (const src of sources) {
    R = src.roots;
    for (const f of src.files) {
      const t = readJson(path.join(src.dir, f), src.roots.extra ? `${path.basename(src.dir)}/${f}` : f);
      if (!t) continue;
      if (src.roots.extra && t.phase !== undefined) { skippedV3.push(t.id); v3Dirs.add(src.dir); continue; }
      validateShape(f, t, skillevalDirs.has(src.dir) || importDirs.has(src.dir), importDirs.has(src.dir) ? IMPORT_RUBRIC_MAX : 6);
      if (seen.has(t.id)) err(f, `duplicate id "${t.id}" (also ${seen.get(t.id)})`);
      seen.set(t.id, f);
      tasks.push(t);
      rootsOf.set(t, src.roots);
    }
  }
  R = DEFAULT_ROOTS;
  return { tasks, seen, rootsOf, skillevalDirs, importDirs, skippedV3, v3Dirs };
}

/** The fixture checks: the bench's fixtures by the classes that use them (unless `onlyExtra`), then each extra dir's. */
function validateAllFixtures(ctx, onlyExtra, extraDirs, benchTasks) {
  const used = new Set(benchTasks.map((t) => t.fixture).filter(isStr));
  const onlyClass = (cls) => new Set([...used].filter((f) => benchTasks.filter((t) => t.fixture === f).every((t) => t.class === cls)));
  if (!onlyExtra) validateFixtures(used, onlyClass('hard'), onlyClass('autonomy'));
  for (const dir of extraDirs) {
    const fx = path.join(dir, 'fixtures');
    if (!fs.existsSync(fx)) continue;
    R = extraRoots(dir);
    const own = ctx.tasks.filter((t) => ctx.rootsOf.get(t).dir === dir);
    if (!own.length && ctx.v3Dirs.has(dir)) continue; // a scenario batch: its fixtures are the dry run's to check
    const usedHere = new Set(own.map((t) => t.fixture).filter(isStr));
    validateFixtures(usedHere, new Set([...usedHere].filter((f) => own.filter((t) => t.fixture === f).every((t) => t.class === 'hard'))), new Set(), fx, ctx.importDirs.has(dir), new Set([...usedHere].filter((f) => own.filter((t) => t.fixture === f).every((t) => t.class === 'complex'))));
  }
  R = DEFAULT_ROOTS;
}

/** Pattern criteria are judged only against a task's Pattern key, so a task that declares one must have the key. */
function checkPatternKeys(ctx) {
  const qualityPack = loadPack('quality');
  for (const t of ctx.tasks) {
    const fixture = isStr(t.fixture) ? ctx.rootsOf.get(t).fixtures.map((r) => path.join(r, t.fixture, ANSWER_KEY)).find((f) => fs.existsSync(f)) : null;
    const key = fixture ? fs.readFileSync(fixture, 'utf8') : null;
    for (const problem of patternKeyProblems(declaredArtifacts(qualityPack, t), key)) err(t.id, problem);
  }
}

function checkToolchainPins(tasks) {
  try {
    const pins = toolchain.loadPins(BENCH);
    for (const id of Object.keys(pins?.tasks || {})) if (!tasks.some((t) => t.id === id)) err('tasks/toolchain/pins.json', `pins a task that does not exist: ${id}`);
  } catch (e) { err('tasks/toolchain/pins.json', e.message); }
}

/** Import tasks have no reference solution: their checks must work on, and not all pass on, the untouched fixture. */
function proveImportTask(t) {
  const bare = copyFixture(t.fixture);
  const outcomes = t.checks.map((c) => evalCheck(bare, c, fixtureDir(t.fixture)));
  fs.rmSync(bare, { recursive: true, force: true });
  outcomes.forEach((r, i) => { if (r.broken) err(t.id, `checks[${i}] is broken on the untouched fixture (${r.detail})`); });
  if (outcomes.some((r, i) => t.checks[i].type !== 'fixture_unchanged') && outcomes.every((r) => r.pass)) err(t.id, 'every check already passes on the untouched fixture');
}

/**
 * The proofs for one task with a fixture and a reference solution (R is the task's roots): its checks work and do not
 * all pass on the untouched fixture, pass on the solution, need the work, catch the negative cases, and fail the
 * keyword stub. Adds to `report` (guards, negativeCases, stubs, hard, autonomy).
 */
function proveTask(t, report) {
  const where = t.id;
  const fixture = fixtureDir(t.fixture);
  const hiddenDir = t.hidden ? path.join(R.hidden, t.hidden) : null;
  const pristine = copyFixture(t.fixture);
  const results = t.checks.map((c) => ({ c, r: evalCheck(pristine, c, fixture, hiddenDir) }));
  fs.rmSync(pristine, { recursive: true, force: true });
  results.forEach(({ r }, i) => {
    if (r.broken) err(where, `checks[${i}] is broken on the untouched fixture (${r.detail})`);
    if (r.pass) report.guards += 1;
  });
  if (results.every(({ r }) => r.pass)) err(where, 'every check already passes on the untouched fixture');

  const overlay = path.join(R.solutions, t.id);
  if (!fs.existsSync(overlay)) {
    err(where, `missing reference solution at ${R.extra ? `${path.basename(R.dir)}/solutions` : 'tasks/solutions'}/${t.id}/`);
    return;
  }
  const passes = (d, c) => evalCheck(d, c, fixture, hiddenDir).pass;
  const solved = copyFixture(t.fixture, overlay);
  t.checks.forEach((c, i) => {
    const r = evalCheck(solved, c, fixture, hiddenDir);
    if (!r.pass) err(where, `checks[${i}] (${c.type}${c.path ? ' ' + c.path : ''}) fails on the reference solution: ${r.detail}`);
  });
  fs.rmSync(solved, { recursive: true, force: true });
  for (const i of controls.passingOnEmpty(t, passes)) {
    const c = t.checks[i];
    err(where, `checks[${i}] (${c.type}${c.path ? ' ' + c.path : ''}) passes on an empty workspace, so it proves nothing; make it need the work`);
  }
  for (const rel of controls.deletionGaps(t, overlay, () => copyFixture(t.fixture, overlay), passes)) {
    warn(where, `every check still passes with ${rel} deleted`);
  }
  if (t.class === 'hard' || t.class === 'complex') report.hard.push(validateHard(t, overlay, hiddenDir));
  if (t.class === 'autonomy') report.autonomy.push(validateAutonomyEvidence(t, overlay, hiddenDir));

  const spec = loadCases(R.negatives, t.id);
  if (spec) {
    checkCases({
      task: t, spec,
      makeWorkspace: () => copyFixture(t.fixture, overlay),
      evalOne: (dir, c) => evalCheck(dir, c, fixture).pass,
    }).forEach((p) => err(where, p));
    report.negativeCases += spec.cases.length;
  }
  proveStub(t, overlay, report);
}

/** The keyword-only stub must fail at least one check, and not only keyword checks. */
function proveStub(t, overlay, report) {
  const stub = path.join(R.stubs, t.id);
  if (!fs.existsSync(stub)) {
    if (DOC_CLASSES.includes(t.class)) err(t.id, `missing keyword stub at ${R.extra ? `${path.basename(R.dir)}/stubs` : 'tasks/stubs'}/${t.id}/`);
    return;
  }
  const stubbed = copyFixture(t.fixture, overlay);
  fs.cpSync(stub, stubbed, { recursive: true });
  const failed = t.checks
    .map((c) => ({ c, r: evalCheck(stubbed, c, fixtureDir(t.fixture)) }))
    .filter(({ r }) => !r.pass);
  fs.rmSync(stubbed, { recursive: true, force: true });
  if (failed.length === 0) err(t.id, 'the keyword-only stub passes every check');
  else if (!failed.some(({ c }) => ['min_matches', 'cmd', 'labelled_findings'].includes(c.type) || defaultCheckTypes().plugin(c.type)?.meta.realCheck === true)) {
    err(t.id, 'the keyword-only stub fails only keyword checks (no min_matches or cmd check caught it)');
  }
  report.stubs.push(`${t.id} ${failed.length}/${t.checks.length}`);
}

/**
 * Runs each task's proofs by its kind. Returns { guards, negativeCases, stubs, hard, autonomy, real }.
 * Prints one line per task to stderr as it goes (index, id, seconds), because a full run takes minutes: hidden test
 * suites run several times per hard task, and nothing else is printed until the summary (D-261).
 */
function proveAllTasks(ctx, manifest) {
  const report = { guards: 0, negativeCases: 0, stubs: [], hard: [], autonomy: [], real: [] };
  process.stderr.write(`validate-tasks: proving ${ctx.tasks.length} task(s)\n`);
  ctx.tasks.forEach((t, i) => {
    const started = Date.now();
    proveOne(ctx, manifest, t, report);
    process.stderr.write(`validate-tasks: ${i + 1}/${ctx.tasks.length} ${t.id} ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  });
  R = DEFAULT_ROOTS;
  return report;
}

/** The proofs for one task by its kind; adds to `report`. */
function proveOne(ctx, manifest, t, report) {
  R = ctx.rootsOf.get(t);
  if (t.class === 'real' && manifest && Array.isArray(t.checks)) { report.real.push(validateRealTask(t, manifest)); return; }
  if (t.class === 'trigger') return;
  if (ctx.skillevalDirs.has(R.dir)) {
    if (t.checks.length) err(t.id, 'skilleval tasks are text-only and carry no checks');
    if (!t.prompt.endsWith(NO_QUESTIONS)) err(t.id, 'prompt must end with the no-questions sentence');
    if (!Array.isArray(t.rubric) || t.rubric.length < 4 || t.rubric.length > 6) err(t.id, 'skilleval rubric needs 4 to 6 items');
    return;
  }
  if (!isStr(t.fixture) || !fs.existsSync(fixtureDir(t.fixture)) || !Array.isArray(t.checks)) return;
  if (ctx.importDirs.has(R.dir)) { proveImportTask(t); return; }
  proveTask(t, report);
}

function checkVerdictPatterns(tasks) {
  for (const t of tasks) {
    if (!Array.isArray(t.checks)) continue;
    t.checks.forEach((c, i) => {
      if (c.type === 'contains' && /verdict|needs fixes|not ready|ready for (cr|release)/i.test(c.pattern || '') && new RegExp(c.pattern, PATTERN_FLAGS).test(VERDICT_LISTING)) {
        err(t.id, `checks[${i}] matches a bare list of verdict words; match a verdict line`);
      }
    });
  }
}

/** Reads and checks one suite file's shape and judge panel. Returns the suite, or null when it is missing. */
function readSuite(name, seen) {
  const file = path.join(SUITES_DIR, `${name}.json`);
  const at = `suites/${name}.json`;
  const s = fs.existsSync(file) ? readJson(file, at) : null;
  if (!s) { err(at, 'missing or unreadable'); return null; }
  if (!Array.isArray(s.tasks) || s.tasks.length === 0) err(at, 'tasks must be a non-empty array');
  else {
    if (new Set(s.tasks).size !== s.tasks.length) err(at, 'tasks has duplicates');
    for (const id of s.tasks) if (!seen.has(id)) err(at, `unknown task id "${id}"`);
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
  return s;
}

/** A suite named for a class runs one at a time and holds only tasks of that class. */
function checkClassSuite(suites, name, cls, tasks) {
  const s = suites[name];
  if (!s) return;
  if (s.parallel !== 1) err(`suites/${name}.json`, 'parallel must be 1 (wall-clock comparisons need one run at a time)');
  if (!cls) return;
  for (const id of s.tasks || []) {
    const t = tasks.find((x) => x.id === id);
    if (t && t.class !== cls) err(`suites/${name}.json`, `task "${id}" is not ${cls === 'autonomy' ? 'an' : 'a'} ${cls} task`);
  }
}

/** The suite files: shape, tags matching the tasks, the LITE spread, and the one-at-a-time rule. Returns the suites. */
function validateSuites(tasks, seen, benchTasks) {
  const suites = {};
  for (const name of ['lite', 'full', 'hard', 'real', 'autonomy', 'requirements', 'pilot']) {
    const s = readSuite(name, seen);
    if (s) suites[name] = s;
  }
  for (const [name, s] of Object.entries(suites)) {
    if (!Array.isArray(s.tasks)) continue;
    const expected = benchTasks.filter((t) => Array.isArray(t.tiers) && t.tiers.includes(name)).map((t) => t.id).sort();
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
  checkClassSuite(suites, 'real', 'real', tasks);
  checkClassSuite(suites, 'autonomy', 'autonomy', tasks);
  checkClassSuite(suites, 'pilot', null, tasks);
  checkClassSuite(suites, 'hard', 'hard', tasks);
  return suites;
}

/** The capability registry, checked against this checkout's own skills, agents, SOPs and context files. */
function checkCapabilityRegistry(tasks) {
  const repoRoot = path.resolve(BENCH, '..');
  const registry = loadRegistry(BENCH);
  const capFindings = validateRegistry(registry, { scan: scanRepo(repoRoot), specs: loadAgentSpecs(repoRoot), tasks: new Map(tasks.map((t) => [t.id, t])), baseDir: repoRoot });
  for (const f of capFindings) (f.level === 'error' ? err : warn)(f.where, f.msg);
  console.log(`capabilities: ${registry.entries.length} registry entr${registry.entries.length === 1 ? 'y' : 'ies'}`);
}

function printSummary(ctx, extraDirs, benchTasks, report, suites) {
  const { tasks, skippedV3 } = ctx;
  const byClass = {};
  for (const t of tasks) byClass[t.class] = (byClass[t.class] || 0) + 1;
  console.log(`tasks: ${tasks.length} ${JSON.stringify(byClass)}${extraDirs.length ? ` (${tasks.length - benchTasks.length} from ${extraDirs.length} extra dir(s))` : ''}`);
  console.log(`checks passing on untouched fixtures (regression guards): ${report.guards}`);
  console.log(`keyword-only stubs (failing checks / total): ${report.stubs.join(', ')}`);
  console.log(`negative and positive cases for loosened checks: ${report.negativeCases}`);
  report.hard.forEach((h) => console.log(`hard ${h}`));
  report.autonomy.forEach((a) => console.log(`autonomy ${a}`));
  report.real.forEach((r) => console.log(`real ${r}`));
  for (const [name, s] of Object.entries(suites)) {
    if (Array.isArray(s.judges)) console.log(`suite ${name}: judges ${s.judges.join(', ')}; tasks ${s.tasks.length}`);
  }
  warnings.forEach((w) => console.log(`warning: ${w}`));
  if (skippedV3.length) console.log(`skipped ${skippedV3.length} v3 scenario task(s) (${skippedV3.slice(0, 3).join(', ')}${skippedV3.length > 3 ? ', ...' : ''}): check them with \`bench.js scenarios lint DIR\` and the batch dry run`);
}

function main() {
  // --only-extra checks the directories named with --extra-tasks alone: no bench tasks, suites, hygiene scan or registry.
  const onlyExtra = process.argv.includes('--only-extra');
  const named = extraDirsFromArgs();
  // Otherwise the extra directories that suite files declare ("extraTasks") are checked too, with or without --extra-tasks.
  const extraDirs = onlyExtra ? named : [...new Set([...fs.readdirSync(SUITES_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.manifest.json'))
    .flatMap((f) => suiteExtraDirs(path.basename(f, '.json'), BENCH)), ...named])];
  if (onlyExtra && !extraDirs.length) { console.error('validate-tasks: --only-extra needs --extra-tasks DIR'); process.exit(2); }
  const ctx = loadAllTasks(onlyExtra, extraDirs);
  const { tasks } = ctx;
  const manifest = tasks.some((t) => t.class === 'real') ? readJson(path.join(BENCH, 'real', 'manifest.json'), 'real/manifest.json') : null;
  const benchTasks = tasks.filter((t) => !ctx.rootsOf.get(t).extra);
  validateAllFixtures(ctx, onlyExtra, extraDirs, benchTasks);
  checkPatternKeys(ctx);
  if (!onlyExtra) checkToolchainPins(tasks);
  const report = proveAllTasks(ctx, manifest);
  checkVerdictPatterns(tasks);
  let suites = {};
  if (!onlyExtra) {
    if (manifest) report.real.push(validateRealSet(tasks, manifest));
    suites = validateSuites(tasks, ctx.seen, benchTasks);
    scanHygiene();
    checkCapabilityRegistry(tasks);
  }
  printSummary(ctx, extraDirs, benchTasks, report, suites);
  if (errors.length) {
    errors.forEach((e) => console.error(`error: ${e}`));
    console.error(`FAILED with ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('OK');
}

/**
 * Points TMPDIR at a fresh dir of this run's own and removes it when the process exits. The checks run fixture, solution
 * and hidden tests (and tests an agent wrote) that make temp dirs and may never remove them; their children inherit
 * TMPDIR, so whatever they leave goes with this dir instead of piling up in the caller's TMPDIR.
 * shortcut: a SIGKILL of the validator leaves this one dir behind; move it under a reaper if that is ever seen.
 */
function ownTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-validate-run-'));
  process.env.TMPDIR = dir;
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
}

ownTempDir();
main();
