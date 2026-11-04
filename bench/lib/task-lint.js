// SPDX-License-Identifier: Apache-2.0
/**
 * Task Lint
 *
 * Checks the quality of one benchmark task before it is run. The verdict of a run is the gap
 * between the with-skill and the without-skill arm, so anything both arms can do cancels out of it.
 * That is why this lint does not try to show that a workspace which did not do the task cannot pass.
 * It finds the faults that would mislead a run or waste it: a task that cannot be read, a start
 * workspace that differs from the one declared, a check that is wrong, and wording that only the
 * skill text gives away. `lintTask` takes one task and workspace snapshots (see checks.js) and
 * reports gates (`failures`) and advice (`warnings`).
 *
 * Gates. Any of these makes `ok` false:
 *
 *   task_invalid         The task fails `validateTask` (shape, quoting rules, check syntax).
 *   snapshot_invalid     A snapshot is missing, is not a plain object, or is over the size ceilings
 *                        (MAX_SNAPSHOT_FILES files, MAX_SNAPSHOT_FILE_CHARS characters in one file,
 *                        MAX_SNAPSHOT_CHARS in all). The ceilings bound what the patterns read;
 *                        they do not bound the time a pattern takes on a file within them, which the
 *                        work budget does.
 *   skill_text_missing   `options.skillText` is not a string with visible text. The rubric quoting
 *                        rule, the `target_section` check and the skill-only-wording check cannot
 *                        run without it, so the lint refuses and runs nothing else.
 *   fixtures_mismatch    The paths in `task.fixtures` and the files of the start snapshot disagree,
 *                        so the declared starting point is not the one the checks were linted on.
 *   start_passes         Stay-out tasks only (below). The untouched start workspace passes every
 *                        check. Doing nothing is the correct behavior of such a task, so a stay-out
 *                        check that the start workspace fails is wrong.
 *   reference_passes     Only when a reference snapshot is given. A reference solution, a workspace
 *                        where the work is done properly, passes every check. A check the reference
 *                        fails is wrong and would punish the arm that did the work right.
 *   work_budget_exhausted  The work budget ran out (checks.js "Total cost"), so some patterns were not
 *                        run and no verdict rests on all of them. Added whatever else passed.
 *
 * Warnings. These never fail the lint. Each names the checks involved:
 *
 *   start_fails          The untouched start workspace passes every check. A check that passes at the
 *                        start adds nothing to the gap between the arms. It does no harm.
 *   unearned_checks      Fewer than MIN_EARNED_SHARE of the checks are earned: a `file_exists`,
 *                        `contains` or `file_absent` check that the start workspace fails. A
 *                        `not_contains` or `fixture_unchanged` check passes when nothing is done, so
 *                        both arms pass it and it cancels. A `file_exists` check on a path that a
 *                        `contains` check also reads is one measurement and counts once when both
 *                        fail at the start, and so do nested `file_absent` paths (`a`, `a/b`).
 *   duplicate_checks     Two checks measure the same thing. "The same" is what a check measures and
 *                        not how it is spelled: two `contains` (or two `not_contains`) checks on one
 *                        path are one measurement when their patterns are equal after the shared text
 *                        fold, or when each pattern accepts every text built for the other
 *                        (`candidateMatches`, run under the time limit); two `file_absent` checks are
 *                        the same when their paths are the same ignoring case and compatibility
 *                        forms. A repeat skews the share of checks that feeds the word-check gate
 *                        and never the judge score. This compares behavior on built texts; it does
 *                        not decide whether two patterns accept the same language, which nothing can.
 *   trespass_fails       Stay-out tasks only. A trespass workspace, built here from the task, passes
 *                        a check, or a check's rule could not be broken, or a check gave no verdict
 *                        on it. Such a check cannot detect what it guards. It adds no gap, and no bias.
 *   no_reference         The task has checks and no reference snapshot was given, so
 *                        `reference_passes` did not run.
 *   literal_in_request   A `contains` pattern matches wording that is already in the task request (or
 *                        cannot be shown not to within the time limit), so a subject can pass it by
 *                        quoting the request.
 *   stay_out_task        The task is a stay-out task (below), so its score shows that the subject
 *                        stayed out and is not evidence that any work was done.
 *
 * Stay-out tasks. A near-miss task can be one whose correct behavior is to do nothing: the request
 * looks like the skill's territory but falls outside it. A task is a stay-out task only if its
 * `kind` is `near-miss` and every one of its checks is a stay-out check (`not_contains`,
 * `fixture_unchanged` or `file_absent`). Every such check passes on an untouched workspace, so the
 * work-based advice (`start_fails`, `unearned_checks`) does not apply to it; `start_passes` applies
 * in its place. One `file_exists` or `contains` check puts the task back on the ordinary path.
 *
 * A task with no checks is judged by the rubric alone. The lint has nothing to say about checks it
 * does not have, so such a task gets no `start_fails`, `unearned_checks` or `no_reference` warning.
 *
 * The module is pure and dependency-free: it reads no files, spawns no processes and makes no
 * network calls. Loading the snapshots is the caller's job (see snapshot-loader.js). It never
 * throws. The start workspace is also the pristine snapshot that `fixture_unchanged` compares the
 * other workspaces against. Every pattern run is under the time limit of checks.js, and the whole
 * lint, including validating its task, runs under one work budget (`options.budget`, default
 * BUDGET_LIMITS.lint).
 *
 * Result: `{ ok, failures, warnings, results }`.
 *   ok        true when no gate failed.
 *   failures  one `{ condition, message }` per failed gate, in the order above.
 *   warnings  one `{ code, message }` per piece of advice.
 *   results   `{ start, reference }`, each the array `evalChecks` returned for that workspace, or
 *             null when the checks were not evaluated or no reference was given. A stay-out task
 *             has a third key, `trespass`.
 *
 * `options.skillText` is required and is passed to `validateTask`.
 */

const { validateTask } = require('./task-schema');
const {
  evalChecks,
  compilePattern,
  testBounded,
  isIndeterminate,
  runWithBudget,
  exhaustionReason,
  foldedPath,
  MATCH_TIMEOUT_MS,
} = require('./checks');
const { candidateMatches } = require('./pattern-syntax');
const { isSkippedName } = require('./safe-path');
const { isBlankText, foldedForm } = require('./text-fold');

const CONDITIONS = Object.freeze({
  TASK_INVALID: 'task_invalid',
  SNAPSHOT_INVALID: 'snapshot_invalid',
  SKILL_TEXT_MISSING: 'skill_text_missing',
  FIXTURES_MISMATCH: 'fixtures_mismatch',
  START_PASSES: 'start_passes',
  REFERENCE_PASSES: 'reference_passes',
  WORK_BUDGET_EXHAUSTED: 'work_budget_exhausted',
});

const WARNINGS = Object.freeze({
  START_FAILS: 'start_fails',
  UNEARNED_CHECKS: 'unearned_checks',
  DUPLICATE_CHECKS: 'duplicate_checks',
  TRESPASS_FAILS: 'trespass_fails',
  NO_REFERENCE: 'no_reference',
  LITERAL_IN_REQUEST: 'literal_in_request',
  STAY_OUT_TASK: 'stay_out_task',
});

/**
 * The most files in one snapshot, the most characters in one file and in all of them. The loader
 * allows 2000 files and 1 MiB each; a benchmark fixture is a few small files, and every file is read
 * by patterns that cost more than linear time, so the lint takes less.
 */
const MAX_SNAPSHOT_FILES = 200;
const MAX_SNAPSHOT_FILE_CHARS = 100000;
const MAX_SNAPSHOT_CHARS = 1000000;

/** The snapshots the caller supplies. `start` is required; `reference` is optional. */
const ROLES = Object.freeze(['start', 'reference']);
const REQUIRED_ROLES = Object.freeze(['start']);

/**
 * Check kinds that an untouched workspace can fail, and so can earn credit for doing the work. The
 * share counts only the checks the start workspace actually fails.
 */
const EARNED_KINDS = Object.freeze(['file_exists', 'contains', 'file_absent']);
/** Check kinds an untouched workspace passes, the only kinds a stay-out task may hold. */
const STAY_OUT_KINDS = Object.freeze(['not_contains', 'fixture_unchanged', 'file_absent']);
/** Smallest share of a task's checks that must be earned checks, below which `unearned_checks` warns. */
const MIN_EARNED_SHARE = 0.5;

/** Most checks named in one message. */
const MAX_LISTED_CHECKS = 5;
/** Most task problems named in a `task_invalid` message. */
const MAX_LISTED_PROBLEMS = 5;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function label(result) {
  const target = result.path === null ? result.type : `${result.type} ${result.path}`;
  return `checks[${result.index}] ${target} (${result.detail})`;
}

/** Joins at most `limit` items with "; " and says how many were left out. */
function listed(items, limit) {
  const shown = items.slice(0, limit).join('; ');
  return items.length > limit ? `${shown}; and ${items.length - limit} more` : shown;
}

function failure(condition, message) {
  return { condition, message };
}

function warning(code, message) {
  return { code, message };
}

function earlyFailure(failures) {
  return { ok: false, failures, warnings: [], results: { start: null, reference: null } };
}

/** The type and path of check `index`, for a message. */
function describe(task, index) {
  const check = task.checks[index];
  return `checks[${index}] ${check.type} ${check.path}`;
}

/** Entry `entry` of a fixtures list covers file `key` when it is that file or a directory holding it. */
function covers(entry, key) {
  return key === entry || key.startsWith(`${entry}/`);
}

/**
 * `task.fixtures` must describe the start snapshot. A fixtures entry may name a file or a directory.
 * The loader records `.git` and `node_modules` as marker entries and `fixtures` may not name a path
 * through either (task-schema.js), so a marker can never be declared; it is reported on its own,
 * with the way out, and not as an undeclared file that no edit to `fixtures` could fix.
 */
function fixturesFailure(task, start) {
  const files = Object.keys(start);
  const absent = task.fixtures.filter((entry) => !files.some((key) => covers(entry, key)));
  const markers = files.filter((key) => key.split('/').some(isSkippedName));
  const undeclared = files.filter((key) => !markers.includes(key) && !task.fixtures.some((entry) => covers(entry, key)));
  if (absent.length === 0 && undeclared.length === 0 && markers.length === 0) return null;
  const parts = [];
  if (absent.length) parts.push(`declared but not in the start snapshot: ${listed(absent, MAX_LISTED_CHECKS)}`);
  if (undeclared.length) parts.push(`in the start snapshot but not declared: ${listed(undeclared, MAX_LISTED_CHECKS)}`);
  if (markers.length) {
    parts.push(
      `the start snapshot holds entries the loader does not read (${listed(markers, MAX_LISTED_CHECKS)}), which fixtures may not name; remove them from the start workspace`,
    );
  }
  return failure(CONDITIONS.FIXTURES_MISMATCH, `task.fixtures and the start snapshot disagree; ${parts.join('; ')}`);
}

/** Most witness texts kept per pattern when two patterns are compared by what they accept. */
const MAX_WITNESSES = 4;

/**
 * What a `contains` or `not_contains` check measures, as `{ regex, witnesses, folded }`: the
 * pattern compiled as a substring search, up to MAX_WITNESSES texts the pattern's own syntax says
 * it accepts and that the expression does accept (`candidateMatches`, each run under the time
 * limit), and the pattern in the shared text fold (text-fold.js: case, spacing and invisible
 * characters ignored). Null when the pattern does not compile, which validation reports.
 */
function patternMeasurement(check) {
  // Both kinds are compared as substring searches, which is what `not_contains` runs. The whole-word
  // wrapper a `contains` check puts around a plain literal is left out on purpose: with it,
  // `rollback plan` and `rollback plan.*` would be told apart by one word boundary, and each would
  // still measure the same wording.
  const { regex } = compilePattern(check.pattern, '', { substring: true });
  if (!regex) return null;
  const witnesses = [];
  for (const text of candidateMatches(check.pattern)) {
    if (witnesses.length >= MAX_WITNESSES) break;
    if (testBounded(regex, text) === true) witnesses.push(text);
  }
  return { regex, witnesses, folded: foldedForm(check.pattern) };
}

/**
 * Whether two checks on the same path and kind measure the same thing. They do when the patterns
 * are equal once folded, or when each pattern accepts every witness text of the other, so that no
 * text built here tells them apart: case, a wrapping `(?:...)`, an alternation branch repeated, an
 * optional tail all land here. A pattern with no witness text is compared by its folded form
 * alone, and a run that gave no verdict counts as "different" (the work budget reports that case
 * on its own).
 */
function sameMeasurement(a, b) {
  if (a === null || b === null) return false;
  if (a.folded === b.folded) return true;
  if (a.witnesses.length === 0 || b.witnesses.length === 0) return false;
  return a.witnesses.every((text) => testBounded(b.regex, text) === true) && b.witnesses.every((text) => testBounded(a.regex, text) === true);
}

/**
 * The `duplicate_checks` warning, or null. Two checks with the same kind, path and measurement are
 * one check. The key leaves out `negatives` and `allowAdditions`, because they change how a check
 * is declared, not what it tests.
 */
function duplicateWarning(task) {
  const groups = new Map();
  const repeats = [];
  task.checks.forEach((check, index) => {
    // The path is folded the way file_absent folds it, because on a case-insensitive filesystem
    // `Changelog.md` and `CHANGELOG.md` are one file and the checks on them are one measurement.
    const key = `${check.type}\u0000${foldedPath(check.path)}`;
    const firsts = groups.get(key) || [];
    const hasPattern = check.type === 'contains' || check.type === 'not_contains';
    const measurement = hasPattern ? patternMeasurement(check) : null;
    const match = hasPattern ? firsts.find((first) => sameMeasurement(first.measurement, measurement)) : firsts[0];
    if (match !== undefined) repeats.push(`${describe(task, index)} repeats checks[${match.index}]`);
    else groups.set(key, [...firsts, { index, measurement }]);
  });
  if (repeats.length === 0) return null;
  return warning(
    WARNINGS.DUPLICATE_CHECKS,
    `the task repeats a check, which counts one measurement more than once in the word-check share: ${listed(repeats, MAX_LISTED_CHECKS)}`,
  );
}

/**
 * The indices of `file_exists` checks that a `contains` check on the same path makes redundant, and
 * of `file_absent` checks nested below another `file_absent` path. `contains` fails when the file is
 * missing, so passing it implies the file exists; a path that is absent has everything under it
 * absent too. Only a check that FAILED in the workspace being judged (`results`) is merged, so a
 * merge can lower the share of work still to do and never raise it: three idle `file_exists`, three
 * idle `contains` on the same files and three earned `contains` must read as 3 of 9 earned, not 3 of 6.
 */
function subsumedIndices(task, results) {
  const readers = new Set(task.checks.filter((check) => check.type === 'contains').map((check) => check.path));
  const failed = new Set(results.filter((result) => result.passed === false).map((result) => result.index));
  const absent = task.checks.flatMap((check, index) => (check.type === 'file_absent' ? [{ index, folded: foldedPath(check.path) }] : []));
  const subsumed = new Set();
  task.checks.forEach((check, index) => {
    if (!failed.has(index)) return;
    if (check.type === 'file_exists' && readers.has(check.path)) subsumed.add(index);
    if (check.type === 'file_absent') {
      const mine = foldedPath(check.path);
      if (absent.some((other) => other.index !== index && mine.startsWith(`${other.folded}/`))) subsumed.add(index);
    }
  });
  return subsumed;
}

/** The `start_fails` warning, or null. Only a task that has checks can have one. */
function startFailsWarning(results) {
  if (results.length === 0 || !results.every((result) => result.passed)) return null;
  return warning(
    WARNINGS.START_FAILS,
    `the starting workspace passes all ${results.length} checks, so none of them can separate an arm that did the work from one that did not`,
  );
}

/** The `unearned_checks` warning, or null: the share of checks an untouched workspace fails and that reward doing something. */
function unearnedWarning(task, startResults) {
  const subsumed = subsumedIndices(task, startResults);
  const counted = startResults.filter((result) => !subsumed.has(result.index));
  if (counted.length === 0) return null;
  // A failure that gave no verdict (timeout, could not be evaluated) is not work to be earned.
  const earned = counted.filter((result) => EARNED_KINDS.includes(result.type) && !result.passed && !isIndeterminate(result));
  const share = earned.length / counted.length;
  if (share >= MIN_EARNED_SHARE) return null;
  const idle = counted.filter((result) => !earned.includes(result)).map((result) => describe(task, result.index));
  const mergedExists = [...subsumed].filter((index) => task.checks[index].type === 'file_exists').length;
  const mergedAbsent = subsumed.size - mergedExists;
  const merged =
    (mergedExists === 0 ? '' : `; ${mergedExists} file_exists check${mergedExists === 1 ? '' : 's'} on a path that a contains check also reads ${mergedExists === 1 ? 'was' : 'were'} counted once, with that check`) +
    (mergedAbsent === 0 ? '' : `; ${mergedAbsent} file_absent check${mergedAbsent === 1 ? '' : 's'} under a path that another file_absent check names ${mergedAbsent === 1 ? 'was' : 'were'} counted once, with that check`);
  return warning(
    WARNINGS.UNEARNED_CHECKS,
    `only ${earned.length} of ${counted.length} checks need work to pass (${Math.round(share * 100)}%), and at least ${Math.round(MIN_EARNED_SHARE * 100)}% should; ` +
      `an untouched workspace already satisfies: ${listed(idle, MAX_LISTED_CHECKS)}${merged}`,
  );
}

function referenceFailure(results) {
  const failed = results.filter((result) => !result.passed);
  if (failed.length === 0) return null;
  return failure(
    CONDITIONS.REFERENCE_PASSES,
    `the reference solution fails ${failed.length} of ${results.length} checks: ${listed(failed.map(label), MAX_LISTED_CHECKS)}`,
  );
}

/** Why `textFor` found nothing. */
const NO_BUILT_TEXT = 'no candidate text satisfies the pattern';

/**
 * A text that satisfies `pattern`: `{ text }`, or `{ reason }` when none could be built. The
 * candidates are guesses built from the pattern's syntax; the first one the real expression accepts
 * is used. Each guess is run through `testBounded`, and a guess on which the pattern does not finish
 * ends the search at once, since every further guess could cost another MATCH_TIMEOUT_MS.
 */
function textFor(pattern) {
  const { regex } = compilePattern(pattern);
  if (!regex) return { reason: 'the pattern does not compile' };
  for (const text of candidateMatches(pattern)) {
    const verdict = testBounded(regex, text);
    if (verdict === null) return { reason: `the pattern did not finish within ${MATCH_TIMEOUT_MS} ms on a candidate text` };
    if (verdict) return { text };
  }
  return { reason: NO_BUILT_TEXT };
}

function appendLine(files, path, line) {
  const current = files.get(path);
  files.set(path, typeof current === 'string' && current !== '' ? `${current}\n${line}` : line);
}

/**
 * Breaks the rule a stay-out check guards, in `files` (the workspace under construction, a Map from
 * path to content). Returns null when the rule was broken, or a string saying why it could not be.
 * Only an explicit null is success.
 */
function breakRule(check, files, start) {
  switch (check.type) {
    case 'not_contains': {
      // A line that matches the check's pattern.
      if (typeof files.get(check.path) !== 'string') {
        return 'the file is not a text file in the start workspace, so no line can be added to it';
      }
      const found = textFor(check.pattern);
      if (found.text === undefined) return found.reason;
      appendLine(files, check.path, found.text);
      return null;
    }
    case 'file_absent':
      // Judge the start workspace, not the one under construction: an earlier check may have made the file.
      if (Object.hasOwn(start, check.path)) return 'the forbidden file is already in the start workspace';
      files.set(check.path, '');
      return null;
    case 'fixture_unchanged': {
      // One edited text file at or under the fixture path.
      const target = Object.keys(start).sort().find((key) => covers(check.path, key) && typeof start[key] === 'string');
      if (target === undefined) return 'there is no text file at or under the fixture path to edit';
      files.set(target, `${files.get(target)}\ntrespass`);
      return null;
    }
    default:
      return `no way to break a ${check.type} check is known`;
  }
}

/**
 * The trespass workspace of a stay-out task: the start workspace plus, for every `file_absent`
 * check an empty file at its path, for every `not_contains` check a line that matches its pattern,
 * and for every `fixture_unchanged` check one edited fixture file. Returns
 * `{ workspace, unbuildable }`, the second being the checks whose rule could not be broken, each as
 * `{ index, reason }`. Later checks only append to or add files, and a check counts as detecting
 * the trespass only if it FAILS the finished workspace, so a clumsy trespass can only make the lint
 * warn about a sound check and never hide a weak one.
 */
function trespassWorkspace(task, start) {
  const files = new Map(Object.entries(start));
  const unbuildable = [];
  task.checks.forEach((check, index) => {
    const reason = breakRule(check, files, start);
    if (reason !== null) unbuildable.push({ index, reason: typeof reason === 'string' ? reason : 'the attack did not report success' });
  });
  return { workspace: Object.fromEntries(files), unbuildable };
}

/** A `contains` pattern that already matches the request text is earned by quoting the request. */
function requestWarnings(task) {
  const quoted = [];
  task.checks.forEach((check, index) => {
    if (check.type !== 'contains') return;
    const { regex } = compilePattern(check.pattern);
    if (!regex) return;
    // The match runs under the time limit, and a run that did not finish cannot be shown not to
    // match, so it is reported with the patterns that do.
    if (testBounded(regex, task.task) !== false) quoted.push(describe(task, index));
  });
  if (quoted.length === 0) return [];
  return [
    warning(
      WARNINGS.LITERAL_IN_REQUEST,
      `these patterns match wording that is already in the task request, so a subject can pass them by quoting it: ${listed(quoted, MAX_LISTED_CHECKS)}`,
    ),
  ];
}

/** The reasons of `entries` without repeats, for a message. */
function reasonsOf(entries) {
  return [...new Set(entries.map(({ reason }) => reason))].join('; ');
}

/**
 * Whether a stay-out task is a stay-out task: a near-miss task whose every check is one an
 * untouched workspace passes. Such a task asks for no work, so the work-based advice cannot apply.
 */
function isStayOut(task) {
  return task.kind === 'near-miss' && task.checks.length > 0 && task.checks.every((check) => STAY_OUT_KINDS.includes(check.type));
}

/** A stay-out task's untouched start workspace is the correct answer, so it must pass every check. */
function startPassesFailure(results) {
  const failed = results.filter((result) => !result.passed);
  if (failed.length === 0) return null;
  return failure(
    CONDITIONS.START_PASSES,
    `the starting workspace fails ${failed.length} of ${results.length} checks; in a stay-out task doing nothing is the correct answer, so the untouched workspace must pass every check: ${listed(failed.map(label), MAX_LISTED_CHECKS)}`,
  );
}

/**
 * The `trespass_fails` warning, or null. Every check of a stay-out task should fail on the trespass
 * workspace, or it guards nothing. A check whose rule could not be broken is named, and a failure
 * that gave no verdict is not counted as a detection.
 */
function trespassWarning(task, results, unbuildable) {
  const passing = results.filter((result) => result.passed);
  const silent = results.filter((result) => isIndeterminate(result));
  const parts = [];
  if (unbuildable.length > 0) {
    parts.push(
      `the rule could not be broken for ${listed(unbuildable.map(({ index }) => describe(task, index)), MAX_LISTED_CHECKS)}, so they cannot be shown to guard anything (${reasonsOf(unbuildable)})`,
    );
  }
  if (passing.length > 0) {
    parts.push(`a workspace where the forbidden thing was done still passes ${passing.length} of ${results.length} checks, so they cannot detect it: ${listed(passing.map(label), MAX_LISTED_CHECKS)}`);
  }
  if (silent.length > 0) {
    parts.push(`these checks gave no verdict on that workspace: ${listed(silent.map(label), MAX_LISTED_CHECKS)}`);
  }
  return parts.length === 0 ? null : warning(WARNINGS.TRESPASS_FAILS, parts.join('; '));
}

/** The failure for a lint whose work budget ran out, or null. Some patterns were not run, so no verdict rests on all of them. */
function budgetFailure() {
  const spent = exhaustionReason();
  if (spent === null) return null;
  return failure(
    CONDITIONS.WORK_BUDGET_EXHAUSTED,
    `the lint ran out of its work budget (${spent}), so some patterns were not run and the task cannot be shown sound; simplify its patterns, use fewer negatives or smaller fixtures`,
  );
}

/**
 * Why a snapshot is too large to lint against, or null. The ceilings are on the number of files,
 * on one file and on the total, in characters.
 */
function snapshotSizeProblem(snapshot) {
  const keys = Object.keys(snapshot);
  if (keys.length > MAX_SNAPSHOT_FILES) return `holds ${keys.length} files, the limit is ${MAX_SNAPSHOT_FILES}`;
  let total = 0;
  for (const key of keys) {
    const content = snapshot[key];
    const size = typeof content === 'string' ? content.length : 0;
    if (size > MAX_SNAPSHOT_FILE_CHARS) return `holds a file of ${size} characters (${echoPath(key)}), the limit is ${MAX_SNAPSHOT_FILE_CHARS}`;
    total += size;
  }
  return total > MAX_SNAPSHOT_CHARS ? `holds ${total} characters in all, the limit is ${MAX_SNAPSHOT_CHARS}` : null;
}

function echoPath(path) {
  return JSON.stringify(path.length > 60 ? `${path.slice(0, 60)}...` : path);
}

/** The failure for a lint asked for without the skill text, or null. */
function skillTextFailure(options) {
  const supplied = isObject(options) && typeof options.skillText === 'string' && !isBlankText(options.skillText);
  if (supplied) return null;
  return failure(
    CONDITIONS.SKILL_TEXT_MISSING,
    'options.skillText was not supplied (or has no visible text), so the rubric quoting rule and the target_section check cannot run and the task cannot be shown free of quoting; pass the skill text',
  );
}

/** The snapshot of `role` when the caller gave one, else undefined. A null or missing reference is no reference. */
function snapshotOf(source, role) {
  return Object.hasOwn(source, role) && source[role] !== undefined && source[role] !== null ? source[role] : undefined;
}

function lintUnderBudget(task, snapshots, options) {
  const taskProblems = validateTask(task, options);
  if (taskProblems.length > 0) {
    return earlyFailure(
      [failure(CONDITIONS.TASK_INVALID, `the task is invalid: ${listed(taskProblems, MAX_LISTED_PROBLEMS)}`), budgetFailure()].filter(Boolean),
    );
  }

  const source = isObject(snapshots) ? snapshots : {};
  const given = ROLES.filter((role) => snapshotOf(source, role) !== undefined || REQUIRED_ROLES.includes(role));
  const badRoles = given.filter((role) => !isObject(source[role]));
  if (badRoles.length > 0) {
    return earlyFailure([
      failure(CONDITIONS.SNAPSHOT_INVALID, `these workspace snapshots are missing or not plain objects: ${badRoles.join(', ')}`),
    ]);
  }
  const oversized = given.map((role) => ({ role, problem: snapshotSizeProblem(source[role]) })).filter(({ problem }) => problem !== null);
  if (oversized.length > 0) {
    return earlyFailure([
      failure(CONDITIONS.SNAPSHOT_INVALID, `these workspace snapshots are too large to lint against: ${oversized.map(({ role, problem }) => `${role} ${problem}`).join('; ')}`),
    ]);
  }

  const pristine = source.start;
  const reference = snapshotOf(source, 'reference');
  const hasChecks = task.checks.length > 0;
  const stayOut = isStayOut(task);
  const warnings = requestWarnings(task);
  const duplicates = duplicateWarning(task);
  if (duplicates !== null) warnings.push(duplicates);

  const results = {
    start: evalChecks(pristine, task.checks, { pristine }),
    reference: reference === undefined ? null : evalChecks(reference, task.checks, { pristine }),
  };
  const failures = [fixturesFailure(task, pristine)];

  if (stayOut) {
    failures.push(startPassesFailure(results.start));
    const trespass = trespassWorkspace(task, pristine);
    results.trespass = evalChecks(trespass.workspace, task.checks, { pristine });
    const trespassed = trespassWarning(task, results.trespass, trespass.unbuildable);
    if (trespassed !== null) warnings.push(trespassed);
    warnings.push(
      warning(
        WARNINGS.STAY_OUT_TASK,
        'this is a stay-out task: an untouched workspace passes every check by design, so its score shows that the subject stayed out and is not evidence that any work was done',
      ),
    );
  } else if (hasChecks) {
    const startProblem = startFailsWarning(results.start);
    if (startProblem !== null) warnings.push(startProblem);
    // When the start workspace passes every check, start_fails has already said that nothing is earned.
    const unearned = startProblem === null ? unearnedWarning(task, results.start) : null;
    if (unearned !== null) warnings.push(unearned);
  }

  if (results.reference !== null) failures.push(referenceFailure(results.reference));
  else if (hasChecks) {
    warnings.push(
      warning(
        WARNINGS.NO_REFERENCE,
        'no reference solution was given, so the checks were not run against a workspace where the work is done; a check that the right answer fails would punish the arm that did the work',
      ),
    );
  }
  // Last, so it sees every run the steps above made. An exhausted budget fails the lint whatever else is true.
  failures.push(budgetFailure());

  const gates = failures.filter(Boolean);
  return { ok: gates.length === 0, failures: gates, warnings, results };
}

/**
 * Lints one task against `snapshots = { start, reference? }` and `options = { skillText, budget? }`.
 * Returns `{ ok, failures, warnings, results }` as described in the module header. Never throws.
 */
function lintTask(task, snapshots, options) {
  try {
    // The skill text is checked first, and nothing else is run without it.
    const missing = skillTextFailure(options);
    if (missing !== null) return earlyFailure([missing]);
    return runWithBudget(options, 'lint', () => lintUnderBudget(task, snapshots, options));
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('options.budget')) {
      return earlyFailure([failure(CONDITIONS.TASK_INVALID, 'options.budget must be a budget made by createBudget')]);
    }
    // A pre-parsed task or snapshot can carry a getter that throws.
    return earlyFailure([failure(CONDITIONS.TASK_INVALID, 'the task or its snapshots could not be inspected because reading a property threw')]);
  }
}

module.exports = {
  CONDITIONS,
  WARNINGS,
  ROLES,
  REQUIRED_ROLES,
  EARNED_KINDS,
  STAY_OUT_KINDS,
  MIN_EARNED_SHARE,
  MAX_LISTED_CHECKS,
  MAX_SNAPSHOT_FILES,
  MAX_SNAPSHOT_FILE_CHARS,
  MAX_SNAPSHOT_CHARS,
  lintTask,
};
