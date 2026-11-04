// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic Task Checks
 *
 * Evaluates a task's checks against a workspace snapshot. A snapshot is a plain object that maps
 * a relative path (forward slashes, see safe-path.js) to that file's content as a string. The
 * matcher is pure and dependency-free: it never reads the filesystem, spawns a process or calls
 * the network, so a recorded snapshot replays the same verdict offline. Reading a directory into
 * a snapshot is the job of snapshot-loader.js. Nothing here throws on bad input; a malformed
 * check or snapshot yields a failed result with a reason.
 *
 * Stable API: `validateCheck`, `evalCheck`, `evalChecks`, `checkResultsFor`. The remaining exports
 * are helpers and limits exposed for tests and for sibling modules. `checkResultsFor` is what a
 * pair writer calls to fill `check_results` (store.js) for one arm.
 *
 * Check kinds. Each check is a plain object with a `type` and the fields listed here, and no
 * others:
 *   file_exists        { path }                        the snapshot holds a file at `path`
 *   contains           { path, pattern, negatives? }   the file's content matches `pattern`
 *   not_contains       { path, pattern }               the file exists and does not match
 *   fixture_unchanged  { path, allowAdditions? }       `path` is byte-identical to the pristine
 *                                                      snapshot passed as `options.pristine`
 *   file_absent        { path }                        the snapshot holds nothing at `path` (I-7)
 *
 * Every `path` is a safe relative path (safe-path.js) that does not run through a name the loader
 * skips (I-A, below).
 *
 * `negatives` on a `contains` check lists strings that its pattern must reject (finding I-2: the
 * requirement follows the pattern, not the check kind). Evaluating a workspace ignores them;
 * negatives.js uses them to test the pattern itself.
 *
 * Removed kind (finding C). `min_matches` ("the pattern matches at least N times") is no longer a
 * check kind. Counting matches rewarded a pasted word repeated N times, which says nothing about
 * the work. A task that uses it is a validation error that names
 * `contains` as the replacement; `contains` asks whether the structure is there, and a pattern can
 * span as much of it as the author needs. There is no deprecated alias and no flag.
 *
 * Patterns are regular expression sources compiled with the fixed flags in PATTERN_FLAGS (case
 * insensitive, multiline, unicode). A pattern is at most MAX_PATTERN_LENGTH characters and must not
 * match the empty string, because such a pattern accepts every file and so measures nothing.
 *
 * Unicode mode (finding I-9). The `u` flag is always on, so `\p{L}` is a letter class and
 * `\u{41}` is one code point, instead of silently meaning the letter `p` before literal braces.
 * The flag also makes the grammar strict: a pattern that compiled without it may now throw (`a\-b`,
 * `{{name}}`, a lone `]`). Such a pattern is a validation error that says so, never a silent pass.
 *
 * Hostile patterns (finding I-1). Patterns come from task authors, who may be hostile, so a
 * pattern must not be able to hang the harness. Two layers, with different jobs:
 *   - Validation rejects, from the pattern's syntax alone, the shapes that fail in exponential
 *     time (`(\w+\s?)+:`, `(a|ab)+`, thirty optional parts in a row; see `backtrackingRisk` in
 *     pattern-syntax.js). That verdict is the same on every machine.
 *   - Every execution of an author's pattern against text runs through `testBounded` under a
 *     MATCH_TIMEOUT_MS limit (finding A): a workspace file here, and in the sibling modules a
 *     declared negative (negatives.js), the task request and the texts built from a pattern
 *     (task-lint.js). Syntax cannot bound polynomial cost (`a.*b` against a long run of `a` took
 *     30 seconds on a 200,000 character file), and the text can come from the task's own
 *     fixtures. A pattern that hits the limit fails its check; `not_contains` fails too, never
 *     passes. Two things in the library are not under the limit because they cannot run long:
 *     `new RegExp(source)`, which only compiles, and the parser's one-character class test.
 *     The syntax rules above keep the usual run far shorter, but no tighter figure is promised for
 *     one run. A run that reaches the limit is a validation problem (fail closed), which a slow
 *     machine may report where a fast one does not. It is never a hang and never a pass. The limit
 *     bounds one run and not the total; the next paragraph bounds the total.
 *
 * Total cost (finding C-4). A limit on one run does not bound how many runs there are, and the
 * count is the author's to choose. These inputs passed every syntax rule: the pattern
 * `'a{0,16}'.repeat(10) + 'bc'` (ten variable quantifiers, none wide) takes the whole limit on the
 * 122 character negative `'a'.repeat(120) + 'bd'`, so ten negatives cost ten seconds and 3,600
 * would cost an hour; `'(?:a|a)'.repeat(34) + 'bbb'` does the same with an alternation that is not
 * under a quantifier; a negative declared twice was run twice; and three `not_contains` checks of
 * `aaa.*a.*bb` (two wide quantifiers) on a 200,000 character fixture cost twelve seconds inside a
 * lint. Two layers bound the total, and what each does and does not promise is stated here:
 *   - Ceilings on counts, which do not depend on the machine and are checked before anything in
 *     the list runs: MAX_NEGATIVES_PER_CHECK negatives in a check, MAX_CHECKS_PER_TASK checks in a
 *     task, and MAX_PATH_CHARS characters in a path. task-schema.js caps the rubric and the
 *     fixtures and task-lint.js caps the size of a snapshot. A negative declared twice is run
 *     once. These ceilings bound what is read and how many runs there can be; they do not bound the
 *     time of a run, which can be quadratic in the size of a file that is within them.
 *   - A work budget (`createBudget`, BUDGET_LIMITS) that every run of an author's pattern is
 *     charged to: a deadline on the clock and a count of runs. A run gets the smaller of
 *     MATCH_TIMEOUT_MS and the time its budget has left, so the run in flight is cut off at the
 *     deadline and does not finish past it. Once either limit is used up the budget is exhausted
 *     for good, no later run starts, and whoever asked reports it: `evalCheck` gives a result
 *     whose detail says the budget ran out (`isIndeterminate` counts it as "no verdict", like a
 *     timeout), `validateTask` and `validateTaskSet` add a problem, and `lintTask` fails with
 *     `work_budget_exhausted`. An exhausted budget is never a pass. Budgets nest by inheritance: a
 *     task validated inside a lint is charged to the lint's budget, a set to the set's. Entry
 *     points make their own budget when none is in force (`evalChecks`: BUDGET_LIMITS.evaluation,
 *     `validateTask` and `validateNegatives`: validation, `lintTask`: lint, `validateTaskSet`:
 *     taskSet), and a caller may pass `options.budget`, which must come from `createBudget`.
 * What holds, as figures. The time to validate one task, lint one, evaluate one list of checks
 * or validate one set stops growing at BUDGET_LIMITS.validation.ms, .lint.ms, .evaluation.ms and
 * .taskSet.ms (3, 8, 5 and 30 seconds) plus the overshoot: a few milliseconds for the interpreter
 * to notice the deadline and the work between runs, which is linear in inputs the ceilings bound.
 * The run counts in BUDGET_LIMITS are the part that does not depend on the machine. Each is about
 * twice what the largest task the ceilings allow spends (a test pins the headroom), and the limit
 * on time is about two orders of magnitude above what such a task spends (under 100 ms here). The
 * lint's 3,000 runs cover validating the task, comparing its checks and evaluating the start,
 * reference and trespass workspaces. The run count is a backstop that does not depend on the
 * machine; the time limit, and not the run count, is what bounds wall-clock time, and an ordinary
 * task takes a few milliseconds. The set's 100,000 runs stay larger than the lint's in time and
 * runs: a set budget only validates tasks (at most 300 runs for the largest, so 100,000 admits
 * more than 300 of them), and the evaluation of one list is at most 3 * 30 = 90 runs.
 * The cost is that a verdict is no longer a pure function of the task: a slow machine can exhaust
 * a budget that a fast one does not, and reports a failure where the fast one reports success.
 * That is the price of bounding time at all, because the cost of a regular expression cannot be
 * computed from its source. The clock is `performance.now()`. Two things are not bounded: a call
 * of `validateCheck` or `evalCheck` on its own (one check, at most three runs of MATCH_TIMEOUT_MS
 * each), and the number of tasks in a set, which the set's budget makes harmless by failing the
 * tasks it has no time left for.
 *
 * Patterns that match arbitrary prose (finding C-3). Every match of a pattern must consume at
 * least MIN_PATTERN_CHARS characters. A zero-width pattern (`\b`, `^`) and a single-character
 * pattern (`e`, `.`, `[ab]`, `x+`) are rejected outright, because they match nearly any prose and
 * so measure nothing; being classed as strict, they also escaped the negatives requirement. Only
 * the consumed length counts (finding C): text that a lookaround demands without consuming it does
 * not, which is why a lookaround is refused outright (next paragraph). A plain literal pattern (only literal characters, with an optional
 * leading `^` and trailing `$`) matches whole words: `plan` does not match `planets`. The one
 * exception is `not_contains`, which keeps substring matching, because a forbidden word hidden
 * inside a longer word must still be caught. A word is a run of letters, numbers and combining
 * marks of any script, plus `_` (finding I-F; the rule used to list the Latin letters, so `план`
 * matched inside `планета`). The consequence for a script written without spaces (Chinese,
 * Japanese, Thai) is that a plain literal matches only where letters of that script do not run on
 * from it; an author who wants it inside a longer run writes a group or a class, which is not a
 * plain literal and so gets no boundary.
 *
 * Patterns that name text (finding I-3 r4). Every match of a pattern must also contain at least
 * MIN_LITERAL_CHARS characters of literal text, written out in the pattern and not matched by a
 * class. `\w\w\w` and `\w\w\w\w` passed the rules above (each match consumes three or four
 * characters) and validated with any two negatives, but one word satisfies both, so a workspace that
 * wrote `hello` passed every check built from them. A pattern made only of character classes
 * (`\w`, `\d`, `[a-z]`, `.`) is a validation error that says so. The floor counts the fewest literal
 * characters on any path through the pattern: an alternation counts its shortest branch and an
 * optional part counts nothing. `rollback \w+` is 9, `v1\.\d+` is 3 and `\d+\.\d+` is 1. The floor
 * does not make a class-heavy pattern safe, which no count can; it refuses the one shape that
 * names nothing at all.
 *
 * Lookarounds (finding C). A pattern may not contain a lookahead or lookbehind (`(?=`, `(?!`,
 * `(?<=`, `(?<!`). A lookaround lets a short pattern look selective by demanding text it does not
 * consume, and for that reason `t(?=h)`, `e(?=l)`, `(?<=r)o`, `(?=.)x`, `.(?=.)` and `\w(?=\w)` used
 * to validate while matching arbitrary prose. Write the context into the match instead. The only
 * lookarounds in a compiled expression are the ones `wholeWordSource` adds around a plain literal.
 *
 * Missing input. A `contains` or `not_contains` check on a path the snapshot does
 * not hold fails, including `not_contains`: an absent file must not pass just because nothing
 * was written. A path whose value is not a string fails the same way.
 *
 * fixture_unchanged. `path` names a file or a directory. For a directory, every pristine file
 * under it must be present and identical in the workspace. Extra files under it fail the check
 * unless `allowAdditions` is true. A path with no pristine files fails, because the check would
 * otherwise pass vacuously. "Identical" is exact equality of the stored strings, and a value that
 * is not a string never counts as identical (I-7). That is a byte comparison as long as the
 * snapshot was made by snapshot-loader.js, which decodes every file without loss: bytes that are
 * not valid UTF-8 become distinct lone surrogates instead of one replacement character, so two
 * files that differ only in such bytes no longer read as equal.
 *
 * Paths the loader never reads (I-A). snapshot-loader.js skips `.git` and `node_modules` at any
 * depth. A check whose `path` runs through either name (`src/node_modules/x.js`) is a validation
 * error, because no snapshot can ever hold the file: `file_absent` on it would pass while the file
 * sits on disk, and `file_exists`, `contains` and `fixture_unchanged` could never pass. The loader
 * records each skipped entry as a marker, a key for its path with the value `''`, so the entry is
 * not invisible. A marker counts as an entry under its parent: it keeps `file_absent` on that
 * parent from passing, and a marker the pristine snapshot lacks is an addition for
 * `fixture_unchanged`, which fails unless `allowAdditions` is true. `fixture_unchanged` on a
 * directory whose pristine snapshot holds a marker fails with a detail that says why, because a
 * marker carries no content to compare and an edit inside the skipped directory would go unseen; a
 * task that needs such a directory checked must name a subtree that does not contain it.
 *
 * file_absent (I-7). The check passes when the snapshot holds no file at `path` and none under it,
 * so a directory that still holds files is not absent. The comparison ignores case and Unicode
 * compatibility forms, because case-insensitive filesystems (macOS, Windows) treat `Changelog.md`
 * and `CHANGELOG.md` as one file and a subject must not satisfy the check by changing the case.
 * It passes on an empty snapshot, so on its own it rewards doing nothing; task-lint.js accounts
 * for that (see its header on stay-out tasks).
 *
 * Not implemented here: checks that run a shell command or an external test runner. They start
 * processes and read the real filesystem, so they need a runner with an allowlist and resource
 * limits of its own. Keeping them out leaves this module safe to call on untrusted snapshots.
 */

const vm = require('node:vm');
const { isSafeRelativePath, isSkippedName, unreadablePathReason } = require('./safe-path');
const { minMatchLength, minLiteralChars, hasLookaround, plainLiteral, backtrackingRisk } = require('./pattern-syntax');

// I-9: `u` is always on. See "Unicode mode" in the header.
const PATTERN_FLAGS = 'imu';
const MAX_PATTERN_LENGTH = 500;
/** I-1: how long one pattern may run against one text before the check fails. */
const MATCH_TIMEOUT_MS = 1000;
/** Fewest characters every match of a pattern must consume (C-3). */
const MIN_PATTERN_CHARS = 2;
/**
 * I-3 r4: fewest characters that every match of a pattern must contain as literal text, written
 * out in the pattern and not matched by a class. `\w\w\w` and `\w\w\w\w` were valid and matched any
 * three- or four-letter word, so one word of that length passed both. A pattern made only of
 * character classes names nothing the work must contain.
 */
const MIN_LITERAL_CHARS = 2;
/**
 * Characters that count as part of a word when a plain literal is matched on word boundaries.
 * `\b` treats only ASCII letters, digits and `_` as word characters even with the `u` flag, so it
 * would match `plan` inside `plané`. I-F: the class used to list the Latin letters, so `план`
 * matched inside `планета`; it now takes every letter, number and combining mark of any script
 * (`\p{L}`, `\p{N}`, `\p{M}`) plus `_`, so the rule does not depend on the alphabet.
 */
const WORD_CHARS = '\\p{L}\\p{N}\\p{M}_';
const WORD_CHAR = new RegExp(`[${WORD_CHARS}]`, 'u');
/** Longest string accepted in a check's `negatives` list. */
const MAX_NEGATIVE_LENGTH = 1000;
/** Longest piece of input text echoed in a detail or problem string. */
const MAX_ECHO = 80;
/**
 * C-4: ceilings on the counts an author chooses. They do not depend on the machine, and a list over
 * its ceiling is a validation error reported before anything in it runs. A tolerant pattern needs
 * two negatives (negatives.js MIN_NEGATIVES), so eight is generous, and thirty checks is several
 * times the size of a task that measures one skill behavior. Paths are bounded too because
 * `file_absent` folds every snapshot key against the path.
 */
const MAX_NEGATIVES_PER_CHECK = 8;
const MAX_CHECKS_PER_TASK = 30;
const MAX_PATH_CHARS = 256;

/**
 * C-4: the work budgets. A budget bounds the total of pattern executions made on its behalf by a
 * deadline on the clock and a count of executions; see "Total cost" in the header. Each figure is
 * about twice what the largest task the ceilings above allow spends (a test pins the headroom), so
 * an ordinary task uses a few milliseconds of them. `evaluation` is for `evalChecks`, `validation`
 * for `validateTask` and `validateNegatives`, `lint` for `lintTask` (it includes the validation of
 * its task), and `taskSet` for `validateTaskSet`.
 */
const BUDGET_LIMITS = Object.freeze({
  evaluation: Object.freeze({ ms: 5000, runs: 200 }),
  validation: Object.freeze({ ms: 3000, runs: 700 }),
  lint: Object.freeze({ ms: 8000, runs: 3000 }),
  taskSet: Object.freeze({ ms: 30000, runs: 100000 }),
});

/** C-4: the budgets `createBudget` made, so a caller cannot pass a look-alike object. */
const BUDGETS = new WeakSet();
/** C-4: the budget that executions are charged to right now, or null. Entry points set it for the length of one synchronous call. */
let activeBudget = null;

/**
 * C-4: a limit on the total pattern work done under it. `admit` is asked before every execution
 * and answers how many milliseconds the execution may run, or 0 when it must not start: once the
 * budget is exhausted it stays exhausted. Nothing here is a verdict; whoever asked reports it.
 */
class WorkBudget {
  constructor(limits) {
    this.limitMs = limits.ms;
    this.limitRuns = limits.runs;
    this.deadline = performance.now() + limits.ms;
    this.runs = 0;
    this.reason = null;
    BUDGETS.add(this);
  }

  /** Why the budget ran out, or null while it has not. */
  get exhausted() {
    return this.reason;
  }

  /** The milliseconds the next execution may take, or 0 when the budget does not allow another. */
  admit() {
    if (this.reason !== null) return 0;
    if (this.runs >= this.limitRuns) {
      this.reason = `more than ${this.limitRuns} pattern runs`;
      return 0;
    }
    const left = this.deadline - performance.now();
    if (left < 1) {
      this.reason = `the ${this.limitMs} ms time limit was reached`;
      return 0;
    }
    this.runs += 1;
    return Math.min(MATCH_TIMEOUT_MS, Math.floor(left));
  }

  /** An execution that the deadline cut short, so the budget is spent. */
  cutShort() {
    if (this.reason === null) this.reason = `the ${this.limitMs} ms time limit was reached`;
  }
}

/** C-4: a new budget with `limits = { ms, runs }`, both positive integers. */
function createBudget(limits) {
  const ok = limits !== null && typeof limits === 'object' && Number.isSafeInteger(limits.ms) && limits.ms > 0 && Number.isSafeInteger(limits.runs) && limits.runs > 0;
  if (!ok) throw new TypeError('createBudget: limits must be { ms, runs }, both positive integers');
  return new WorkBudget(limits);
}

function isBudget(value) {
  return value !== null && typeof value === 'object' && BUDGETS.has(value);
}

/**
 * C-4: why the budget in force has run out, or null when none is in force or it has not.
 */
function exhaustionReason() {
  return activeBudget === null ? null : activeBudget.exhausted;
}

/**
 * C-4: runs `body` with `budget` in force and returns its result. Budgets nest by inheritance: an
 * entry point called while one is in force charges that one, so validating a task inside a lint
 * is paid for by the lint.
 */
function withBudget(budget, body) {
  const previous = activeBudget;
  activeBudget = budget;
  try {
    return body(budget);
  } finally {
    activeBudget = previous;
  }
}

/**
 * C-4: the entry-point helper. Runs `body` under `options.budget` when the caller supplied one, else
 * under the budget already in force, else under a new one of BUDGET_LIMITS[`name`]. `options.budget`
 * that `createBudget` did not make is refused with a TypeError, so a caller cannot opt out of the
 * bound by passing something that merely looks like one.
 */
function runWithBudget(options, name, body) {
  const supplied = options !== null && typeof options === 'object' && Object.hasOwn(options, 'budget') ? options.budget : undefined;
  if (supplied !== undefined) {
    if (!isBudget(supplied)) throw new TypeError('options.budget must be a budget made by createBudget');
    return withBudget(supplied, body);
  }
  if (activeBudget !== null) return body(activeBudget);
  return withBudget(createBudget(BUDGET_LIMITS[name]), body);
}

function negativesProblem(value) {
  if (Array.isArray(value) && value.length > MAX_NEGATIVES_PER_CHECK) {
    // C-4: counted before anything is run, so an oversized list costs one length check.
    return `has ${value.length} entries, the limit is ${MAX_NEGATIVES_PER_CHECK}`;
  }
  const ok =
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item !== '' && item.length <= MAX_NEGATIVE_LENGTH);
  return ok ? null : `must be an array of non-empty strings, each at most ${MAX_NEGATIVE_LENGTH} characters`;
}

/**
 * I-A: a path is acceptable when it is a safe relative path and the snapshot loader can read it. A
 * path through `.git` or `node_modules` never appears in a snapshot, so a check on it would pass or
 * fail for reasons that have nothing to do with the workspace (`file_absent` would pass on a file
 * that is on disk). Rejecting it here is the fail-closed answer: the task is invalid, not satisfied.
 */
function pathProblem(value) {
  if (!isSafeRelativePath(value)) return 'must be a relative path inside the workspace';
  // C-4: bounded before any comparison reads it.
  if (value.length > MAX_PATH_CHARS) return `has ${value.length} characters, the limit is ${MAX_PATH_CHARS}`;
  const unreadable = unreadablePathReason(value);
  return unreadable === null ? null : `${unreadable}; name a path the loader reads`;
}

const FIELD_RULES = {
  path: pathProblem,
  pattern: (value) => patternProblem(value),
  allowAdditions: (value) => (typeof value === 'boolean' ? null : 'must be true or false'),
  negatives: negativesProblem,
};

/** For each kind: the fields that must be present and the fields that may be. */
const CHECK_SHAPES = {
  file_exists: { required: ['path'], optional: [] },
  contains: { required: ['path', 'pattern'], optional: ['negatives'] },
  not_contains: { required: ['path', 'pattern'], optional: [] },
  fixture_unchanged: { required: ['path'], optional: ['allowAdditions'] },
  // I-7: a path that must not exist, so a task can assert that something was not created.
  file_absent: { required: ['path'], optional: [] },
};

const CHECK_KINDS = Object.freeze(Object.keys(CHECK_SHAPES));

/**
 * C: check kinds that used to exist, with the reason each was removed and what to write instead.
 * A removed kind is reported by name and is not folded into the generic "must be one of" message,
 * so an author who still writes one is told where to go.
 */
const REMOVED_KINDS = Object.freeze({
  min_matches:
    'min_matches was removed because counting matches rewards a word pasted N times and does not measure the work; use contains with a pattern that spans the structure you need',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function echo(value) {
  const text = String(value);
  return JSON.stringify(text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}...` : text);
}

// I-1: the script below is fixed text. The pattern and the text reach them only as values in
// the context, so no author-controlled source is ever evaluated; node:vm is used for its timeout.
const TEST_SCRIPT = new vm.Script('result = regex.test(text);');
const MATCH_CONTEXT = vm.createContext({ regex: null, text: '', result: undefined });

/**
 * I-1: runs `script` over `regex` and `text` under `limitMs`, which is MATCH_TIMEOUT_MS or, under a
 * work budget (C-4), less. Returns the script's result, or null when the limit was hit. Any other
 * failure propagates to the caller's own guard.
 */
function runBounded(script, regex, text, limitMs) {
  MATCH_CONTEXT.regex = regex;
  MATCH_CONTEXT.text = text;
  MATCH_CONTEXT.result = undefined;
  try {
    script.runInContext(MATCH_CONTEXT, { timeout: limitMs });
    return MATCH_CONTEXT.result;
  } catch (error) {
    if (error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return null;
    throw error;
  } finally {
    MATCH_CONTEXT.regex = null;
    MATCH_CONTEXT.text = '';
  }
}

/**
 * I-1: whether `regex` matches `text`, true or false, or null when it did not finish in time.
 * C-4: under a work budget the run is first admitted by the budget and gets the smaller of
 * MATCH_TIMEOUT_MS and the time the budget has left. A budget that does not admit the run gives
 * null without running it, the same "no verdict" answer as a timeout; `exhaustionReason` tells the
 * two apart.
 */
function testBounded(regex, text) {
  let limitMs = MATCH_TIMEOUT_MS;
  if (activeBudget !== null) {
    limitMs = activeBudget.admit();
    if (limitMs === 0) return null;
  }
  const result = runBounded(TEST_SCRIPT, regex, text, limitMs);
  if (result === null && limitMs < MATCH_TIMEOUT_MS) activeBudget.cutShort();
  return result;
}

/**
 * I-9: why `pattern` does not compile. When it compiles without the `u` flag, the reason says so,
 * because that is the pattern an author wrote under the old rules and needs to be told to rewrite.
 */
function invalidPatternMessage(pattern, flags, error) {
  const full = String(error && error.message);
  const detail = full.split(`/${flags}: `).pop().slice(0, MAX_ECHO);
  try {
    new RegExp(pattern, flags.replace('u', ''));
  } catch {
    return `is not a valid regular expression (${detail})`;
  }
  return `is not valid in unicode mode, which every check pattern uses (${detail}); escape only syntax characters (^ $ \\ . * + ? ( ) [ ] { } | /) and write a literal "{", "}" or "]" escaped`;
}

/**
 * C-3: a plain literal pattern matches whole words. Returns the source to compile: `pattern`
 * itself when it is not a plain literal or when neither edge of the literal is a word character
 * (`--dry-run` needs no boundary), otherwise the pattern wrapped in lookarounds that refuse a
 * neighbouring word character. Without this, `plan` matched `planets` and `explanation`.
 */
function wholeWordSource(pattern) {
  const literal = plainLiteral(pattern);
  if (literal === null) return pattern;
  const before = WORD_CHAR.test(literal.first) ? `(?<![${WORD_CHARS}])` : '';
  const after = WORD_CHAR.test(literal.last) ? `(?![${WORD_CHARS}])` : '';
  return before === '' && after === '' ? pattern : `${before}(?:${pattern})${after}`;
}

/**
 * Compiles `pattern` with PATTERN_FLAGS plus `extraFlags`. Returns `{ regex }` on success or
 * `{ error }` with a short reason: not a string, empty, too long, not a valid expression in
 * unicode mode (I-9), holding a lookaround (C), prone to catastrophic backtracking (I-1), matching
 * the empty string, zero-width, or consuming fewer than MIN_PATTERN_CHARS characters.
 * A plain literal compiles to a whole-word match; `options.substring` turns that off (used by
 * `not_contains`, where a forbidden word inside a longer word must still be caught).
 */
function compilePattern(pattern, extraFlags = '', options) {
  if (typeof pattern !== 'string' || pattern === '') return { error: 'must be a non-empty string' };
  if (pattern.length > MAX_PATTERN_LENGTH) return { error: `is longer than ${MAX_PATTERN_LENGTH} characters` };
  try {
    new RegExp(pattern, PATTERN_FLAGS + extraFlags);
  } catch (error) {
    return { error: invalidPatternMessage(pattern, PATTERN_FLAGS + extraFlags, error) };
  }
  // C: refuse lookarounds before anything else reads the pattern. Fail closed when the parser
  // cannot analyze it: null is not "no lookaround".
  const looks = hasLookaround(pattern);
  if (looks === null) return { error: 'could not be analyzed, so it cannot be shown to measure anything' };
  if (looks) {
    return {
      error:
        'uses a lookahead or lookbehind ((?=, (?!, (?<=, (?<!), which is not allowed: text that a lookaround demands without consuming lets a short pattern look selective while it matches arbitrary prose; write the context into the match',
    };
  }
  // I-1: refuse the exponential shapes before the pattern is executed against anything, even ''.
  const risk = backtrackingRisk(pattern);
  if (risk !== null) return { error: risk };
  const onEmpty = testBounded(new RegExp(pattern, PATTERN_FLAGS), '');
  if (onEmpty === null) {
    // C-4: a run the work budget did not admit is not a slow pattern; say which it was.
    const spent = exhaustionReason();
    return { error: spent === null ? `did not finish within ${MATCH_TIMEOUT_MS} ms on the empty string` : `was not run because the work budget ran out (${spent})` };
  }
  if (onEmpty) {
    return { error: 'matches the empty string, so it would accept every file' };
  }
  // C-3, C: a pattern that can match while consuming fewer than MIN_PATTERN_CHARS characters matches
  // arbitrary prose. Only the consumed length counts; the span-with-lookaround rule is gone. Fail
  // closed when the parser cannot analyze the pattern at all.
  const consumed = minMatchLength(pattern);
  if (consumed === null) return { error: 'could not be analyzed, so it cannot be shown to measure anything' };
  if (consumed === 0) {
    return { error: 'is zero-width (an anchor or word boundary with no text to match), so it would match arbitrary text' };
  }
  if (consumed < MIN_PATTERN_CHARS) {
    return { error: `can match a single character, so it would match arbitrary prose; every match must consume at least ${MIN_PATTERN_CHARS} characters` };
  }
  // I-3 r4: a pattern of character classes with no literal text matches ordinary prose, and one
  // word satisfies it. Require some literal letters or numbers in every match. Fail closed when the
  // parser cannot analyze the pattern.
  const literal = minLiteralChars(pattern);
  if (literal === null) return { error: 'could not be analyzed, so it cannot be shown to measure anything' };
  if (literal < MIN_LITERAL_CHARS) {
    return {
      error: `has no literal text: every match must contain at least ${MIN_LITERAL_CHARS} characters written out in the pattern, and this one is made of character classes (\\w, [a-z], \\d, .) that match ordinary prose, so one word satisfies it; name the words the work must contain`,
    };
  }
  const source = options && options.substring === true ? pattern : wholeWordSource(pattern);
  return { regex: new RegExp(source, PATTERN_FLAGS + extraFlags) };
}

function patternProblem(value) {
  const { error } = compilePattern(value);
  return error || null;
}

function collectCheckProblems(check) {
  if (!isObject(check)) return ['check: must be an object'];
  // C: a removed kind is named, with its replacement, ahead of the generic message.
  if (Object.hasOwn(check, 'type') && typeof check.type === 'string' && Object.hasOwn(REMOVED_KINDS, check.type)) {
    return [`type: ${REMOVED_KINDS[check.type]}`];
  }
  if (!Object.hasOwn(check, 'type') || typeof check.type !== 'string' || !Object.hasOwn(CHECK_SHAPES, check.type)) {
    return [`type: must be one of ${CHECK_KINDS.join(', ')}`];
  }
  const { required, optional } = CHECK_SHAPES[check.type];
  const allowed = ['type', ...required, ...optional];
  const problems = [];
  for (const key of Object.keys(check)) {
    if (!allowed.includes(key)) problems.push(`unknown field ${echo(key)} for a ${check.type} check`);
  }
  for (const field of [...required, ...optional]) {
    if (!Object.hasOwn(check, field)) {
      if (required.includes(field)) problems.push(`${field}: missing`);
      continue;
    }
    const problem = FIELD_RULES[field](check[field]);
    if (problem) problems.push(`${field}: ${problem}`);
  }
  return problems;
}

/**
 * Validates one check definition. Returns an array of problem strings, empty when the check is
 * well formed. Never throws.
 */
function validateCheck(check) {
  try {
    return collectCheckProblems(check);
  } catch {
    // A pre-parsed object can carry a getter that throws.
    return ['check: could not be inspected because reading a property threw'];
  }
}

/** The text of `path` in `snapshot`, or a failed result explaining why there is none. */
function readText(snapshot, path) {
  if (!Object.hasOwn(snapshot, path)) return { failure: { passed: false, detail: 'file missing' } };
  const content = snapshot[path];
  if (typeof content !== 'string') return { failure: { passed: false, detail: 'file content is not a string' } };
  return { text: content };
}

/** Paths in `snapshot` that are `path` itself or lie under it. */
function pathsUnder(snapshot, path) {
  const prefix = `${path}/`;
  return Object.keys(snapshot).filter((key) => key === path || key.startsWith(prefix));
}

/**
 * I-A: the first key of `keys` that is a marker, an entry the loader skipped (`.git`,
 * `node_modules`). Its value says nothing about what is inside, so it cannot be compared.
 */
function firstMarker(keys) {
  return keys.find((key) => key.split('/').some(isSkippedName));
}

function evalFixtureUnchanged(snapshot, check, pristine) {
  if (!isObject(pristine)) return { passed: false, detail: 'no pristine snapshot supplied' };
  const before = pathsUnder(pristine, check.path);
  if (before.length === 0) return { passed: false, detail: 'path not in the pristine snapshot' };
  const after = pathsUnder(snapshot, check.path);
  // I-A: a skipped directory is recorded by presence only. When the pristine side holds one, a file
  // added or edited inside it would still compare as "identical", so the directory cannot be shown
  // unchanged: fail closed and name the marker; narrow `path` to a subtree without one. A marker
  // that only the workspace holds is not in `pristine`, so it falls out below as an extra entry,
  // which fails the check unless `allowAdditions` is true.
  const marker = firstMarker(before);
  if (marker !== undefined) {
    return {
      passed: false,
      detail: `holds an entry the loader does not read (${echo(marker)}), so it cannot be shown unchanged; check a path that does not contain it`,
    };
  }
  const missing = before.filter((key) => !Object.hasOwn(snapshot, key));
  // I-7: both sides must be strings and equal as strings; see "fixture_unchanged" in the header.
  const changed = before.filter(
    (key) =>
      Object.hasOwn(snapshot, key) &&
      !(typeof snapshot[key] === 'string' && typeof pristine[key] === 'string' && snapshot[key] === pristine[key]),
  );
  const extra = check.allowAdditions === true ? [] : after.filter((key) => !Object.hasOwn(pristine, key));
  if (missing.length + changed.length + extra.length === 0) return { passed: true, detail: 'identical' };
  const parts = [];
  if (missing.length) parts.push(`missing ${missing.length} (${echo(missing[0])})`);
  if (changed.length) parts.push(`changed ${changed.length} (${echo(changed[0])})`);
  if (extra.length) parts.push(`extra ${extra.length} (${echo(extra[0])})`);
  return { passed: false, detail: parts.join(', ') };
}

/** I-7: a path in the form file_absent compares: Unicode compatibility folded and lower case. */
function foldedPath(value) {
  return value.normalize('NFKC').toLowerCase();
}

/** I-7: passes when nothing in `snapshot` is at `check.path` or under it, ignoring case. */
function evalFileAbsent(snapshot, check) {
  const wanted = foldedPath(check.path);
  const found = Object.keys(snapshot).find((key) => {
    const folded = foldedPath(key);
    return folded === wanted || folded.startsWith(`${wanted}/`);
  });
  return found === undefined ? { passed: true, detail: 'absent' } : { passed: false, detail: `present (${echo(found)})` };
}

/** I-1: the failed result for a pattern that did not finish within MATCH_TIMEOUT_MS. */
function timedOut() {
  return { passed: false, detail: `pattern did not finish within ${MATCH_TIMEOUT_MS} ms on this file, so the check fails` };
}

/** A: the detail of a result for a check that threw while it was evaluated. */
const UNEVALUABLE_DETAIL = 'check could not be evaluated';
/** C-4: the detail of a result for a check the work budget did not let run. It is no verdict on the workspace. */
const BUDGET_DETAIL = 'the work budget ran out before this check was run, so the check fails';
/** C-4: the detail of a result for a check past MAX_CHECKS_PER_TASK, which is not run. */
const OVER_LIMIT_DETAIL = `the list holds more than ${MAX_CHECKS_PER_TASK} checks, so this check was not run`;

function evaluate(snapshot, check, options) {
  const problems = collectCheckProblems(check);
  if (problems.length > 0) {
    // C-4: a pattern the budget did not let compile is not a malformed check, and "malformed"
    // would read as a verdict on the workspace to a caller that counts failures.
    if (exhaustionReason() !== null) return { passed: false, detail: BUDGET_DETAIL };
    return { passed: false, detail: `malformed check: ${problems[0]}` };
  }
  if (!isObject(snapshot)) return { passed: false, detail: 'workspace snapshot must be a plain object' };

  if (check.type === 'file_exists') {
    const present = Object.hasOwn(snapshot, check.path) && typeof snapshot[check.path] === 'string';
    return { passed: present, detail: present ? 'present' : 'missing' };
  }
  if (check.type === 'file_absent') return evalFileAbsent(snapshot, check);
  if (check.type === 'fixture_unchanged') {
    return evalFixtureUnchanged(snapshot, check, isObject(options) ? options.pristine : undefined);
  }

  const { text, failure } = readText(snapshot, check.path);
  if (failure) return failure;
  // C-3: not_contains keeps substring matching so a forbidden word inside a longer word is caught.
  const compiled = compilePattern(check.pattern, '', check.type === 'not_contains' ? { substring: true } : undefined);
  // C-4: the second compile ran under the budget too, and may have been the run it refused.
  if (!compiled.regex) return exhaustionReason() !== null ? { passed: false, detail: BUDGET_DETAIL } : { passed: false, detail: `malformed check: pattern: ${compiled.error}` };
  const matched = testBounded(compiled.regex, text);
  // I-1: a pattern that never finished proves nothing, so not_contains must not pass on it either.
  if (matched === null) return exhaustionReason() !== null ? { passed: false, detail: BUDGET_DETAIL } : timedOut();
  const passed = check.type === 'contains' ? matched : !matched;
  return { passed, detail: matched ? 'matched' : 'no match' };
}

/**
 * Evaluates one check against a snapshot. `options.pristine` is the starting snapshot that
 * `fixture_unchanged` compares against. Returns `{ passed, detail }`. Never throws.
 */
function evalCheck(snapshot, check, options) {
  try {
    return evaluate(snapshot, check, options);
  } catch {
    return { passed: false, detail: UNEVALUABLE_DETAIL };
  }
}

/**
 * A: whether `result` (from `evalCheck` or `evalChecks`) is a failure that says nothing about the
 * workspace: the pattern did not finish in time, or the check could not be evaluated. A caller
 * that counts failed checks must not count these, because the check never reached a verdict on
 * the workspace.
 */
function isIndeterminate(result) {
  // C-4: a check the work budget did not run, or that lies past the count ceiling, said nothing either.
  return (
    Boolean(result) &&
    result.passed === false &&
    (result.detail === timedOut().detail || result.detail === UNEVALUABLE_DETAIL || result.detail === BUDGET_DETAIL || result.detail === OVER_LIMIT_DETAIL)
  );
}

/** The type and path of a check for reporting, tolerating a malformed check. */
function describeCheck(check) {
  try {
    return {
      type: isObject(check) && typeof check.type === 'string' ? check.type : null,
      path: isObject(check) && typeof check.path === 'string' ? check.path : null,
    };
  } catch {
    return { type: null, path: null };
  }
}

/**
 * Evaluates a list of checks. Returns one `{ index, type, path, passed, detail }` per check, in
 * order. A value that is not an array yields an empty list. Never throws.
 */
function evalChecks(snapshot, checks, options) {
  if (!Array.isArray(checks)) return [];
  const results = [];
  try {
    // C-4: an `options.budget` that createBudget did not make evaluates nothing, and says so for every check.
    const supplied = options !== null && typeof options === 'object' && Object.hasOwn(options, 'budget') ? options.budget : undefined;
    if (supplied !== undefined && !isBudget(supplied)) {
      for (let index = 0; index < checks.length; index += 1) {
        results.push({ index, ...describeCheck(checks[index]), passed: false, detail: UNEVALUABLE_DETAIL });
      }
      return results;
    }
    // C-4: the whole list runs under one work budget, and a check past the count ceiling is not run.
    runWithBudget(options, 'evaluation', () => {
      for (let index = 0; index < checks.length; index += 1) {
        const outcome =
          index >= MAX_CHECKS_PER_TASK ? { passed: false, detail: OVER_LIMIT_DETAIL } : evalCheck(snapshot, checks[index], options);
        results.push({ index, ...describeCheck(checks[index]), ...outcome });
      }
    });
  } catch {
    // An array-like proxy can throw while its elements are read; keep the results gathered so far.
  }
  return results;
}

/**
 * The word-check results of one arm, in the form a pair record stores (`check_results` in
 * store.js): runs the checks of `task` on the arm's final snapshot `final`, with `start` as the
 * pristine side of `fixture_unchanged`, and returns one entry per check, in the task's order:
 * `true` (passed), `false` (failed) or `null` (no verdict: the check timed out, ran out of the work
 * budget, could not be evaluated, or the snapshot it needs was not supplied). A task with no checks
 * gives `[]`. Pure and deterministic given the snapshots; it reads no file and never throws.
 *
 * Both arms of a task are run with the same `start`, so their lists have the same length, which the
 * aggregation requires before it compares them.
 */
function checkResultsFor(task, start, final) {
  try {
    const checks = isObject(task) && Array.isArray(task.checks) ? task.checks : [];
    if (!isObject(final)) return checks.map(() => null);
    const results = evalChecks(final, checks, { pristine: start });
    return checks.map((check, index) => {
      const result = results[index];
      // A list that evalChecks could not finish reading leaves its tail without a result.
      if (result === undefined || isIndeterminate(result)) return null;
      if (isObject(check) && check.type === 'fixture_unchanged' && !isObject(start)) return null;
      return result.passed === true;
    });
  } catch {
    // A task built from a proxy can throw while its checks are read; no result is a result of none.
    return [];
  }
}

module.exports = {
  CHECK_KINDS,
  PATTERN_FLAGS,
  MAX_PATTERN_LENGTH,
  MIN_PATTERN_CHARS,
  MIN_LITERAL_CHARS,
  MAX_NEGATIVE_LENGTH,
  MATCH_TIMEOUT_MS,
  MAX_NEGATIVES_PER_CHECK,
  MAX_CHECKS_PER_TASK,
  MAX_PATH_CHARS,
  BUDGET_LIMITS,
  createBudget,
  isBudget,
  withBudget,
  runWithBudget,
  exhaustionReason,
  foldedPath,
  compilePattern,
  testBounded,
  isIndeterminate,
  validateCheck,
  evalCheck,
  evalChecks,
  checkResultsFor,
};
