// SPDX-License-Identifier: Apache-2.0
/**
 * Negative corpus for tolerant patterns
 *
 * A `contains` pattern that accepts wording variation (`roll(s|ed)? back|revert`) also makes it
 * easy to accept a wrong answer. A task that carries such a pattern must therefore declare
 * strings the pattern has to reject, on the check itself:
 *   { type: 'contains', path, pattern, negatives: ['text a wrong answer might contain', ...] }
 * Each negative is run through the pattern exactly as the check runs it on a file (same flags),
 * and any negative the pattern matches is a problem. (Finding I-2 once extended this to the
 * `min_matches` kind; that kind was removed in finding C, so `contains` is the only one left.)
 *
 * The module is pure and dependency-free: it reads no files, spawns no processes and makes no
 * network calls. It never throws.
 *
 * Stable API: `validateNegatives`, `evaluateNegatives`, `isTolerantPattern`, `MIN_NEGATIVES`.
 *
 * What counts as tolerant. A pattern is tolerant when it can match more than one text of the same
 * shape: it has an alternation (`|`), a quantifier (`?`, `*`, `+`, or a range such as `{1,3}`), a
 * wildcard (`.`), a character class (`[...]`), or one of the class escapes `\s \S \w \W \d \D`
 * and the Unicode property escapes `\p{...}` and `\P{...}` (I-9).
 * Escaped characters, anchors, word boundaries, groups and an exact repeat such as
 * `{2}` do not by themselves make a pattern tolerant. A pattern made only of those is a literal
 * match, so it needs no negatives. The case-insensitive flag is not counted, because every
 * pattern carries it.
 *
 * Scope (finding I-2). The rule follows the pattern, not the check kind: it applies to every check
 * that asserts a pattern is present, which is `contains` alone since `min_matches` was removed
 * (finding C). A tolerant `not_contains` pattern is outside the rule:
 * breadth there errs toward rejecting a good answer, which a reference solution run exposes,
 * and it can never let a wrong answer pass. A negative can still be declared on a strict pattern,
 * and it is evaluated all the same.
 *
 * Time limit (finding I-1). Each negative runs through the pattern under the same time limit as
 * a file does. A negative on which the pattern does not finish counts as accepted, because the
 * pattern cannot then be shown to reject it.
 *
 * Distinct negatives (finding I-D). Two negatives are the same when the shared fold of text-fold.js
 * makes them equal: case, spacing, compatibility forms, accents, look-alike letters and every
 * character that prints nothing (the zero-width space, a combining grapheme joiner, the Hangul
 * fillers, the Braille blank, variation selectors) are ignored, the way task-schema.js compares
 * rubric items. The "letters or digits" count of a negative is taken on the folded text too.
 *
 * Total cost (finding C-4). A check may declare at most MAX_NEGATIVES_PER_CHECK negatives (checks.js);
 * a list over it is one problem and none of it runs. A string declared more than once is run once.
 * Every run is charged to the work budget in force or, when there is none, to a new one of
 * BUDGET_LIMITS.validation (checks.js), and a negative the budget did not let run counts as not
 * rejected, like one that timed out.
 */

const {
  compilePattern,
  testBounded,
  runWithBudget,
  exhaustionReason,
  MATCH_TIMEOUT_MS,
  MAX_NEGATIVES_PER_CHECK,
} = require('./checks');
const { literalRuns } = require('./pattern-syntax');
const { foldedForm } = require('./text-fold');

/** Fewest distinct negatives a tolerant pattern must declare. */
const MIN_NEGATIVES = 2;
/** Fewest letters or digits a declared negative must hold (C-3). */
const MIN_NEGATIVE_WORD_CHARS = 3;
/** Shortest word of the pattern's own text that counts when judging whether a negative is a near miss (C-3). */
const MIN_ANCHOR_CHARS = 3;
/** Words too common to show that a negative resembles the pattern. */
const STOPWORDS = new Set(['the', 'and', 'for', 'not', 'but', 'with', 'you', 'are', 'was', 'has', 'had', 'can', 'its', 'our', 'all']);
/** Longest piece of input text echoed in a problem string. */
const MAX_ECHO = 80;

// I-9: `\p` and `\P` are classes (`\p{L}` matches any letter) now that patterns compile with `u`.
const CLASS_ESCAPES = 'sSwWdDpP';
const RANGE_QUANTIFIER = /^\{\d+,\d*\}/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function echo(value) {
  const text = String(value);
  return JSON.stringify(text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}...` : text);
}

/** True when `pattern` is a string that can match more than one text of the same shape. */
function isTolerantPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  let groupOpenAt = -2;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '\\') {
      if (CLASS_ESCAPES.includes(pattern[i + 1] || '\n')) return true;
      i += 1;
    } else if (char === '(') {
      groupOpenAt = i;
    } else if (char === '[' || char === '|' || char === '.' || char === '*' || char === '+') {
      return true;
    } else if (char === '?') {
      // `(?:`, `(?=`, `(?<name>` and the like open a group; only a bare `?` is a quantifier.
      if (groupOpenAt !== i - 1) return true;
    } else if (char === '{' && RANGE_QUANTIFIER.test(pattern.slice(i))) {
      return true;
    }
  }
  return false;
}

/** The declared negatives that are usable strings, or an empty list. */
function declaredNegatives(check) {
  if (!Array.isArray(check.negatives)) return [];
  return check.negatives.filter((item) => typeof item === 'string' && item !== '');
}

/** I-2: the check kinds whose pattern must be present, and so must be shown to reject wrong wordings. */
const POSITIVE_KINDS = ['contains'];

/** The pattern of a well-formed `contains` check, compiled, or null for any other check. */
function compiledPositive(check) {
  if (!isObject(check) || !POSITIVE_KINDS.includes(check.type)) return null;
  const { regex } = compilePattern(check.pattern);
  return regex || null;
}

/**
 * Runs each declared negative of a `contains` check through its pattern. Returns
 * `{ accepted, tested }`: the negatives the pattern matched, or did not finish on within the time
 * limit (I-1), and how many were run. A check that is not a well-formed `contains` check, or that
 * declares none, gives `{ accepted: [], tested: 0 }`.
 */
function evaluateNegatives(check) {
  try {
    // C-4: the compile and every run below are charged to one work budget.
    return runWithBudget(undefined, 'validation', () => {
      const regex = compiledPositive(check);
      if (regex === null) return { accepted: [], tested: 0 };
      const negatives = declaredNegatives(check);
      // C-4: a list over the ceiling is not run; none of it can be shown to be rejected, so all of it counts as accepted.
      if (negatives.length > MAX_NEGATIVES_PER_CHECK) return { accepted: negatives, tested: 0 };
      // C-4: a string declared twice is run once, since the same text gives the same answer.
      const verdicts = new Map();
      for (const negative of negatives) {
        if (!verdicts.has(negative)) verdicts.set(negative, testBounded(regex, negative) !== false);
      }
      return { accepted: negatives.filter((negative) => verdicts.get(negative)), tested: negatives.length };
    });
  } catch {
    return { accepted: [], tested: 0 };
  }
}

/**
 * C-3: negatives are compared the way the pattern compares text, ignoring case, and with runs of
 * whitespace collapsed, so `Foo` and `foo ` do not count as two negatives.
 *
 * R-3: compatibility forms are folded (`ｆｏｏ` becomes `foo`) and format characters are dropped
 * (the zero-width space and joiners, the soft hyphen, the byte order mark), the way task-schema.js
 * normalizes rubric items (I-4). Without this `foo` and `fo\u200bo` counted as two distinct
 * negatives, so one real negative plus a copy with an invisible character satisfied the
 * "two distinct" rule.
 *
 * I-D: R-3 dropped format characters only, so `rolled forward` and `rolled forward\u034f` (a
 * combining grapheme joiner, which is not a format character), or a copy ending in `\u3164`,
 * `\u2800` or `\ufe0f`, still counted as two. The comparison is now the shared `foldedForm` of
 * text-fold.js, the same function task-schema.js uses for rubric items, so the two cannot disagree
 * about what prints as nothing.
 */
function normalizedNegative(negative) {
  return foldedForm(negative);
}

function wordCharCount(text) {
  // I-D: counted on the folded text, so characters that print nothing but are letters by category
  // (the Hangul fillers `\u3164 \u115f`) do not count as the letters or digits a negative must hold.
  return (foldedForm(text).match(/[\p{L}\p{N}]/gu) || []).length;
}

/**
 * C-3: the MIN_ANCHOR_CHARS-character fragments of the pattern's own literal words, lowercased,
 * that a near-miss negative would share. Only words of at least MIN_ANCHOR_CHARS letters or
 * digits count, and common words do not. A fragment, not the whole word, is required because a
 * pattern that is a list of words (`risks?|hazards?`) accepts any text holding a whole word, so a
 * negative can only resemble it (`risen`, `hazy`). An empty list means the pattern is built from
 * structure alone (`\d{4}-\d{2}`), and the near-miss rule is skipped.
 */
function anchorFragments(pattern) {
  const fragments = new Set();
  for (const run of literalRuns(pattern)) {
    for (const word of run.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
      if (word.length < MIN_ANCHOR_CHARS || STOPWORDS.has(word)) continue;
      for (let i = 0; i + MIN_ANCHOR_CHARS <= word.length; i += 1) fragments.add(word.slice(i, i + MIN_ANCHOR_CHARS));
    }
  }
  return [...fragments];
}

/**
 * Problems with a check's negative corpus, as an array of strings that start with `negatives:`.
 * A tolerant `contains` pattern needs at least MIN_NEGATIVES distinct declared negatives, and every
 * declared negative must be a real test of the pattern (C-3), which takes three things, each
 * actually tested instead of assumed:
 *   - the pattern rejects it. A negative the pattern accepts proves the pattern is too loose.
 *   - it holds at least MIN_NEGATIVE_WORD_CHARS letters or digits. A newline or a single letter is
 *     rejected by almost every pattern, so declaring it shows nothing; with pattern `.` the
 *     negatives `"\n"` and `"\r"` used to pass for that reason.
 *   - it is a near miss: when the pattern has literal words of its own, the negative shares a
 *     MIN_ANCHOR_CHARS-character fragment of one of them, so the pattern rejected it for a reason
 *     and not because it is unrelated text. This is a floor against filler, not proof of quality:
 *     an author can still pick a weak negative that happens to share a fragment.
 * A check that is not a well-formed `contains` check gives no problems
 * here; `validateCheck` reports its faults. Never throws.
 */
function validateNegatives(check) {
  try {
    // C-4: the compile and every run below are charged to one work budget.
    return runWithBudget(undefined, 'validation', () => negativeProblems(check));
  } catch {
    return ['negatives: could not be inspected because reading a property threw'];
  }
}

/** The body of `validateNegatives`, run under its work budget. */
function negativeProblems(check) {
  const regex = compiledPositive(check);
  if (regex === null) return [];
  const problems = [];
  const declared = declaredNegatives(check);
  if (declared.length > MAX_NEGATIVES_PER_CHECK) {
    // C-4: a list over the ceiling is refused before any of it runs.
    return [`negatives: has ${declared.length} entries, the limit is ${MAX_NEGATIVES_PER_CHECK}`];
  }
  const distinct = new Set(declared.map(normalizedNegative)).size;
  if (isTolerantPattern(check.pattern) && distinct < MIN_NEGATIVES) {
    problems.push(`negatives: a tolerant pattern needs at least ${MIN_NEGATIVES} distinct declared negatives, got ${distinct}`);
  }
  const anchors = anchorFragments(check.pattern);
  // C-4: a string declared twice is run once, since the same text gives the same answer.
  const outcomes = new Map();
  for (const negative of declared) {
    if (!outcomes.has(negative)) outcomes.set(negative, testBounded(regex, negative));
    const outcome = outcomes.get(negative);
    if (outcome === null) {
      // I-1: a pattern that never finishes on a negative cannot be shown to reject it.
      const spent = exhaustionReason();
      problems.push(
        spent === null
          ? `negatives: the pattern did not finish within ${MATCH_TIMEOUT_MS} ms on the declared negative ${echo(negative)}, so it cannot be shown to reject it`
          : `negatives: the declared negative ${echo(negative)} was not run because the work budget ran out (${spent}), so the pattern cannot be shown to reject it`,
      );
    } else if (outcome) {
      problems.push(`negatives: the pattern accepts the declared negative ${echo(negative)}`);
    } else if (wordCharCount(negative) < MIN_NEGATIVE_WORD_CHARS) {
      problems.push(
        `negatives: the declared negative ${echo(negative)} has fewer than ${MIN_NEGATIVE_WORD_CHARS} letters or digits, so it cannot stand for a wrong answer`,
      );
    } else if (anchors.length > 0 && !anchors.some((fragment) => negative.toLowerCase().includes(fragment))) {
      problems.push(
        `negatives: the declared negative ${echo(negative)} shares no ${MIN_ANCHOR_CHARS}-character fragment with the pattern's words, so it is not a near miss; write a wrong answer in the pattern's own vocabulary`,
      );
    }
  }
  return problems;
}

module.exports = { MIN_NEGATIVES, MIN_NEGATIVE_WORD_CHARS, isTolerantPattern, evaluateNegatives, validateNegatives };
