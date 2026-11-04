// SPDX-License-Identifier: Apache-2.0
/**
 * Task Schema
 *
 * Defines the shape of one benchmark task and validates a task or a set of tasks. Both
 * validators are pure and dependency-free: they read no files, spawn no processes and make no
 * network calls. They never throw, whatever they are given. Every problem comes back as one
 * string in an array, and an empty array means the input is valid.
 *
 * Stable API: `validateTask`, `validateTaskSet` and the constants. A task is a plain object with
 * exactly these fields, all required:
 *   {
 *     id: string,              // lowercase slug that starts with `<skill>-`, e.g. 'plan-core-basic'
 *     skill: string,           // lowercase slug naming the skill under test
 *     kind: 'core' | 'coverage' | 'near-miss',
 *     task: string,            // the request text the subject receives, at most MAX_TASK_WORDS words
 *                              // and MAX_TASK_CHARS characters
 *     rubric: string[],        // checklist items for a grader, at least MIN_RUBRIC_ITEMS, each
 *                              // distinct, non-blank and at most MAX_RUBRIC_ITEM_CHARS characters
 *     target_section: string,  // a heading of the skill the task exercises, non-empty, at most
 *                              // MAX_TARGET_SECTION_CHARS characters
 *     fixtures: string[],      // relative paths of the files the starting workspace holds, none through
 *                              // `.git` or `node_modules`, at most MAX_FIXTURES of them
 *     checks: object[],        // deterministic checks, each valid under checks.js `validateCheck`
 *   }
 * An unknown top-level field is a problem, so a misspelled field cannot slip through unread.
 *
 * Kinds. `core` tasks exercise what the skill is for. `coverage` tasks exercise a documented
 * branch or less common path. `near-miss` tasks look like the skill's territory but fall outside
 * it, so they measure whether the subject stays out.
 *
 * Check kinds (finding C). The kinds a task may use are the ones `validateCheck` in checks.js
 * accepts: `file_exists`, `contains`, `not_contains`, `fixture_unchanged`, `file_absent`. The
 * `min_matches` kind was removed, and a task that carries it is a problem that names `contains` as
 * the replacement. A pattern may not hold a lookahead or lookbehind either. Both rules live in
 * checks.js, so a set of tasks is held to them through the same `validateCheck` call.
 *
 * Tolerant patterns. A `contains` check whose pattern accepts wording variation must declare
 * `negatives`, strings the pattern has to reject, and no declared negative may match. The rule
 * lives in negatives.js; see its header for what counts as tolerant.
 *
 * Rubric quoting. A rubric that repeats a skill's own phrases rewards an answer that copies the
 * skill instead of one that is correct. The check needs the skill text, and a validator that
 * reads no files cannot fetch it, so the caller supplies it: `options.skillText` for
 * `validateTask`, and `options.skillTexts` (a plain object from skill name to text) for
 * `validateTaskSet`. A rubric item that shares RUBRIC_QUOTE_WORDS or more consecutive words with
 * the skill text is a problem. Without the text the rule is skipped, and a task is not checked for
 * quoting.
 *
 * Quoting that is disguised (finding I-5). The comparison folds both texts the way round 1 folded
 * rubric duplicates (NFKC), and goes further so that a copied phrase survives cosmetic edits. The
 * fold is the shared one of text-fold.js (I-D), which negatives.js uses for its negatives as well:
 *   - case, accents and other combining marks, and every character that prints nothing (zero-width
 *     and other format characters, the Hangul fillers, the Braille blank, lone surrogates; see
 *     text-fold.js for the list by category) are ignored;
 *   - an apostrophe inside a word is ignored whatever its shape, so a curly `don’t` matches the
 *     straight `don't`;
 *   - Cyrillic and Greek letters, and Latin small capitals, that print like a Latin letter are read
 *     as that letter, and a word that mixes Latin with Cyrillic or Greek letters is itself a
 *     problem, so a look-alike missing from the table cannot be used quietly;
 *   - a trailing `ing`, `ed`, `es`, `s` or `ly` is stripped, so `opens` and `opening` are one word;
 *   - a second pass drops filler words ("the", "of", "really") from both texts and looks for the
 *     same RUBRIC_QUOTE_WORDS-word run, so a phrase copied with small words added or removed is
 *     still found;
 *   - a third pass allows other words between the copied ones (finding I-E). The filler list is
 *     finite, so a word that is not on it, such as "indeed", inserted after every third word of a
 *     skill sentence used to leave no six-word run. The pass drops the rubric words the skill text
 *     never uses, so any number of those between copied words changes nothing, and then looks for
 *     RUBRIC_QUOTE_WORDS words that appear in the same order in both texts with at most
 *     QUOTE_GAP_WORDS other words between two of them in either text. Omitted words are covered
 *     the same way. It visits at most MAX_QUOTE_PAIRS word pairs for one item; an item that would
 *     need more is a problem, because the comparison could not be finished.
 * What this does not catch: a rewrite that swaps words for synonyms, reorders the words, or
 * translates the phrase; a copied phrase shorter than RUBRIC_QUOTE_WORDS words; a copy with more
 * than QUOTE_GAP_WORDS words of the skill's own vocabulary inserted between each pair of copied
 * words (words the skill never uses are free to insert and do not hide anything); and a look-alike
 * that substitutes a digit or punctuation mark for a letter (`pl4n`). Paraphrase cannot be decided
 * by string comparison, so the rule narrows the evasion and a grader's judgment is still needed.
 *
 * The rule cannot be switched off by omission without a trace (finding I-5). `validateTask`, given
 * a single task, has no other channel, so a missing `options.skillText` still skips both rules there;
 * task-lint.js refuses to lint a task without the skill text and fails with `skill_text_missing`
 * (finding I-G; it used to be a warning that nothing enforced). `validateTaskSet` reports a
 * problem when `options.skillTexts` is present but is not a plain object, and one per task whose
 * skill has no usable text in it. Omitting `skillTexts` from `options` altogether is the one way
 * left to skip the rules, and it is a deliberate act.
 *
 * Size limits (finding I-3). A word cap alone does not bound size, because one token of two
 * million characters counts as one word. `task`, every rubric item and `target_section` therefore
 * also have a character cap, measured in UTF-16 code units. A field over its cap is reported and
 * not inspected further, so an oversized value costs one length check and nothing more.
 *
 * Rubric items (finding I-4). An item must hold some visible text: a string of spaces, control
 * characters or zero-width characters is blank, not only an empty string. No two items may be the
 * same once case, compatibility forms (full-width letters), zero-width characters and runs of
 * whitespace are normalized away, the way negatives.js normalizes its negatives. Repeating an item
 * would count one criterion twice towards MIN_RUBRIC_ITEMS. Finding I-D: "visible" and "the same"
 * were judged by two different folds here and in negatives.js, and a string of `\u3164\u2800\u115f`
 * (Hangul fillers, Braille blank) counted as text, and an item with `\u2800` appended as a different
 * item. Both modules now call the one fold of text-fold.js, which treats by category every character
 * that prints nothing as nothing.
 *
 * Ceilings on counts (finding C-4). Counts are chosen by the author, so each is capped, and a list
 * over its cap is one problem, reported before any item in it is read: at most MAX_RUBRIC_ITEMS
 * rubric items, MAX_FIXTURES fixtures and MAX_CHECKS_PER_TASK checks (checks.js), each fixture
 * path at most MAX_PATH_CHARS characters. `validateTask` runs under a work budget (checks.js,
 * `options.budget`, default BUDGET_LIMITS.validation) that bounds the total time and number of
 * pattern runs of validating one task, and `validateTaskSet` under one for the whole set; a task
 * whose validation the budget cut short is a problem ("validation ran out of its work budget"),
 * never a pass. checks.js states what the ceilings and the budget do and do not promise.
 *
 * Fixtures (finding I-A). A fixture path that runs through `.git` or `node_modules` is a problem,
 * the way a check's path is, because the snapshot loader never reads either: the declared starting
 * point could not be the one the checks were linted against. The test is `isSkippedName` of
 * safe-path.js.
 *
 * Target section (finding I-6). `target_section` names a heading of the skill's markdown. When the
 * caller supplies the skill text, the heading must exist there: an ATX heading (`## Title`)
 * outside a code fence and outside front matter, compared ignoring case, whitespace and the
 * emphasis marks `* _` and backticks. A section the skill does not have is a problem and not a
 * warning, because a task aimed at nothing measures nothing and the validators have no warning
 * channel. As with quoting, a validator that reads no files cannot fetch the text itself. For
 * `validateTask` a missing `options.skillText` skips the rule. For `validateTaskSet`, when
 * `options.skillTexts` is supplied but holds no text for a task's skill, the section cannot be
 * resolved and that is a problem, so a misspelled skill name cannot turn the rule off.
 *
 * Problem strings start with the field they concern, for example `rubric[1]: ...`. In a set each
 * problem is also prefixed with the task's position, for example `tasks[2]: id: ...`. Text taken
 * from the input is truncated before it is echoed.
 */

const { isSafeRelativePath, isSkippedName } = require('./safe-path');
const { validateCheck, runWithBudget, exhaustionReason, MAX_CHECKS_PER_TASK, MAX_PATH_CHARS } = require('./checks');
const { validateNegatives } = require('./negatives');
const { foldedText: sharedFoldedText, foldedForm, isBlankText, withoutInvisible } = require('./text-fold');

const KINDS = Object.freeze(['core', 'coverage', 'near-miss']);
const TASK_FIELDS = Object.freeze(['id', 'skill', 'kind', 'task', 'rubric', 'target_section', 'fixtures', 'checks']);

/** Most whitespace-separated words allowed in `task`. */
const MAX_TASK_WORDS = 200;
/** I-3: most characters in `task`. 200 words of ordinary length fit in well under half of this. */
const MAX_TASK_CHARS = 4000;
/** I-3: most characters in one rubric item. */
const MAX_RUBRIC_ITEM_CHARS = 1000;
/** I-3: most characters in `target_section`. */
const MAX_TARGET_SECTION_CHARS = 200;
/** Fewest items a rubric may hold. */
const MIN_RUBRIC_ITEMS = 3;
/** C-4: most items a rubric may hold; each one is folded and compared with the whole skill text. */
const MAX_RUBRIC_ITEMS = 20;
/** C-4: most entries in `fixtures`. */
const MAX_FIXTURES = 50;
/** A rubric item sharing this many consecutive words with the skill text counts as quoting it. */
const RUBRIC_QUOTE_WORDS = 6;
/**
 * I-E: the most words that may sit between two copied words, in either text, before the copy stops
 * counting as one phrase. Two covers a filler word inserted after every third word of a sentence.
 */
const QUOTE_GAP_WORDS = 2;
/**
 * I-E: the most (rubric word, skill word) pairs the gapped comparison visits for one rubric item. A
 * rubric item of at most MAX_RUBRIC_ITEM_CHARS characters and a skill text of ordinary size stay far
 * below it; an item that would pass it, such as one word repeated two hundred times against a skill
 * that repeats it ten thousand times, is a problem, because the comparison could not be finished.
 */
const MAX_QUOTE_PAIRS = 500000;
/** Longest piece of input text echoed in a problem string. */
const MAX_ECHO = 40;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu;

// I-5, I-D: the table of look-alike letters, the apostrophe rule and the fold built on them live in
// text-fold.js, which negatives.js uses too, so rubric items and negatives cannot disagree about
// when two strings are the same text.

/**
 * I-5: words that carry no content, dropped before the filler-insensitive quoting rule compares
 * runs. A copied phrase with "the" or "really" inserted or removed is still a copied phrase.
 * `not` and `no` are kept, because they change what a sentence says.
 */
const FILLER_LIST = (
  'a an the of to in on at for by with from into onto upon and or but nor so if then than that this these those it its ' +
  'is are was were be been being am do does did has have had will would shall should can could may might must ' +
  'also just very really quite rather simply only still even already yet about as over under per via ' +
  'you your we our they their he she his her them us me i my any each every all some such there here what which who whom ' +
  'when where while how why'
).split(' ');
/** I-5: words suffixes are stripped from, so `opens`, `opened` and `opening` all read as `open`. */
const STEM_SUFFIXES = Object.freeze(['ing', 'ed', 'es', 's', 'ly']);
/** I-5: a stem keeps at least this many letters, so short words stay whole. */
const MIN_STEM_CHARS = 4;
/**
 * I-5: the filler words in the form `wordsOf` produces, which is stemmed: `really` reads as `real`,
 * so the set holds both forms.
 */
const FILLER_WORDS = new Set([...FILLER_LIST, ...FILLER_LIST.map((word) => stemmedWord(word))]);

/** I-5: `word` without a trailing inflection, keeping at least MIN_STEM_CHARS letters. */
function stemmedWord(word) {
  for (const suffix of STEM_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM_CHARS) return word.slice(0, -suffix.length);
  }
  return word;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * I-4: a string is blank when it shows nothing when printed: separators (including the no-break
 * space), control characters, and format characters such as the zero-width space and joiners.
 * `trim()` removes only some of them, so a rubric item of `"\u200b"` used to count as text.
 * I-D: the judgment is the shared `isBlankText` of text-fold.js, which also counts the characters
 * that print nothing without being separators, controls or format characters (the Hangul fillers,
 * the Braille blank, a combining grapheme joiner, a lone surrogate): `\u3164\u2800\u115f` was
 * three letters to the old test.
 */
function isNonBlankString(value) {
  return typeof value === 'string' && !isBlankText(value);
}

/**
 * I-4, I-5, I-D: the one folding that rubric comparison uses, for duplicates and for quoting, and
 * that negatives.js uses for its negatives: `foldedText` of text-fold.js. See its header for what
 * it folds.
 */
const foldedText = sharedFoldedText;

/**
 * I-4: the form in which two rubric items count as the same: the folded text with whitespace runs
 * collapsed to one space, as negatives.js does for its negatives (I-D: through the same function).
 */
function normalizedRubricItem(item) {
  return foldedForm(item);
}

/**
 * I-5: true when a word of `text` mixes Latin letters with Cyrillic or Greek ones. A rubric item
 * written that way is hiding a phrase from the quoting rule, and no honest item needs it. The Greek
 * mu is exempt, because NFKC turns the micro sign of `5 µs` into it.
 */
function mixesScripts(text) {
  // I-D: invisible characters are dropped first, so one inserted between a Latin and a Cyrillic
  // letter does not split a mixed word into two words that each look single-script.
  for (const word of withoutInvisible(text).match(/[\p{L}\p{M}]+/gu) || []) {
    const letters = word.replace(/\u03bc/gu, '');
    if (/\p{Script=Latin}/u.test(letters) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(letters)) return true;
  }
  return false;
}

/** I-6: the form in which a target section and a heading count as the same. */
function normalizedSection(text) {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[*_`]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * I-6: the normalized titles of the ATX headings in markdown `text`, skipping YAML front matter
 * and fenced code blocks, where a line that starts with `#` is a comment and not a heading.
 */
function headingsOf(text) {
  const headings = new Set();
  const lines = text.split(/\r\n|\r|\n/);
  let first = 0;
  if (/^---\s*$/.test(lines[0])) {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) first = end + 1;
  }
  let fence = null;
  for (let i = first; i < lines.length; i += 1) {
    const line = lines[i];
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      if (fence === null) fence = opening[1][0];
      else if (opening[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading && heading[1] !== '') headings.add(normalizedSection(heading[1]));
  }
  return headings;
}

/** Quotes and truncates untrusted text so a problem string stays short. */
function echo(value) {
  const text = String(value);
  return JSON.stringify(text.length > MAX_ECHO ? `${text.slice(0, MAX_ECHO)}...` : text);
}

/** The folded, stemmed words of `text` (I-5), in order. */
function wordsOf(text) {
  return (foldedText(text).match(WORD_PATTERN) || []).map(stemmedWord);
}

/** I-5: `words` without the filler words. */
function contentWordsOf(words) {
  return words.filter((word) => !FILLER_WORDS.has(word));
}

/** Every run of `size` consecutive words in `words`, joined by a space. */
function runsOf(words, size) {
  const runs = new Set();
  for (let i = 0; i + size <= words.length; i += 1) runs.add(words.slice(i, i + size).join(' '));
  return runs;
}

function hasSharedRun(words, skillRuns) {
  for (let i = 0; i + RUBRIC_QUOTE_WORDS <= words.length; i += 1) {
    if (skillRuns.has(words.slice(i, i + RUBRIC_QUOTE_WORDS).join(' '))) return true;
  }
  return false;
}

/** I-E: where each word occurs in `words`, as a Map from word to the ascending list of positions. */
function positionsOf(words) {
  const positions = new Map();
  words.forEach((word, index) => {
    const list = positions.get(word);
    if (list === undefined) positions.set(word, [index]);
    else list.push(index);
  });
  return positions;
}

/**
 * I-E: whether `words` (a rubric item's content words) copy RUBRIC_QUOTE_WORDS words of the skill
 * text in the same order, with at most QUOTE_GAP_WORDS other words between two copied words in
 * either text. `skillPositions` is `positionsOf` the skill's content words, `skillLength` their
 * count. Words of the rubric item that the skill never uses are ignored. This is the exact-run
 * comparison with insertions and omissions allowed: a word that is not on the filler list, such as
 * "indeed", inserted after every third word used to hide a sentence from it. Returns true, false,
 * or null when the comparison would visit more than MAX_QUOTE_PAIRS pairs and so cannot be finished.
 *
 * It is a longest-chain count: `chain` maps a pair (rubric position i, skill position j) of equal
 * words to the length of the longest copied chain ending there, extending a chain whose last pair
 * lies up to QUOTE_GAP_WORDS + 1 positions back in both texts.
 */
function hasGappedRun(rubricWords, skillPositions, skillLength) {
  const reach = QUOTE_GAP_WORDS + 1;
  const stride = skillLength + 1;
  // A word the skill never uses cannot be part of a copied phrase, so it is dropped before gaps are
  // counted: any number of them inserted between copied words changes nothing.
  const words = rubricWords.filter((word) => skillPositions.has(word));
  const chain = new Map();
  let visited = 0;
  for (let i = 0; i < words.length; i += 1) {
    const here = skillPositions.get(words[i]);
    for (const j of here) {
      visited += 1;
      if (visited > MAX_QUOTE_PAIRS) return null;
      let best = 1;
      for (let di = 1; di <= reach && di <= i; di += 1) {
        for (let dj = 1; dj <= reach && dj <= j; dj += 1) {
          const earlier = chain.get((i - di) * stride + (j - dj));
          if (earlier !== undefined && earlier + 1 > best) best = earlier + 1;
        }
      }
      if (best >= RUBRIC_QUOTE_WORDS) return true;
      chain.set(i * stride + j, best);
    }
  }
  return false;
}

/** Checks `skill` and `id` when present. The prefix rule needs both to be valid slugs. */
function checkSkillAndId(task, problems) {
  const hasSkill = Object.hasOwn(task, 'skill');
  const skillOk = hasSkill && typeof task.skill === 'string' && SLUG_PATTERN.test(task.skill);
  if (hasSkill && !skillOk) problems.push('skill: must be a lowercase slug of letters, digits and single hyphens');

  if (!Object.hasOwn(task, 'id')) return;
  if (typeof task.id !== 'string' || !SLUG_PATTERN.test(task.id)) {
    problems.push('id: must be a lowercase slug of letters, digits and single hyphens');
  } else if (skillOk && !(task.id.startsWith(`${task.skill}-`) && task.id.length > task.skill.length + 1)) {
    problems.push(`id: must start with "${task.skill}-" followed by a name`);
  }
}

function checkRubric(task, options, problems) {
  if (!Array.isArray(task.rubric)) {
    problems.push('rubric: must be an array of strings');
    return;
  }
  if (task.rubric.length < MIN_RUBRIC_ITEMS) {
    problems.push(`rubric: needs at least ${MIN_RUBRIC_ITEMS} items, got ${task.rubric.length}`);
  }
  if (task.rubric.length > MAX_RUBRIC_ITEMS) {
    // C-4: counted before any item is read, so an oversized rubric costs one length check.
    problems.push(`rubric: has ${task.rubric.length} items, the limit is ${MAX_RUBRIC_ITEMS}`);
    return;
  }
  const skillText = isObject(options) && typeof options.skillText === 'string' ? options.skillText : null;
  const skillWords = skillText === null ? null : wordsOf(skillText);
  const skillRuns = skillWords === null ? null : runsOf(skillWords, RUBRIC_QUOTE_WORDS);
  // I-5: the same runs with filler words removed from both sides, so inserting "the" or "really"
  // into a copied phrase does not hide it.
  const skillContentWords = skillWords === null ? null : contentWordsOf(skillWords);
  const skillContentRuns = skillContentWords === null ? null : runsOf(skillContentWords, RUBRIC_QUOTE_WORDS);
  // I-E: where each content word sits in the skill text, for the comparison that allows gaps.
  const skillPositions = skillContentWords === null ? null : positionsOf(skillContentWords);
  const firstSeen = new Map();
  for (let i = 0; i < task.rubric.length; i += 1) {
    const item = task.rubric[i];
    if (!isNonBlankString(item)) {
      // I-4: blank means no visible text, so a zero-width character or a no-break space is blank too.
      problems.push(`rubric[${i}]: must be a non-empty string`);
      continue;
    }
    if (item.length > MAX_RUBRIC_ITEM_CHARS) {
      // I-3: an oversized item is reported and not inspected further.
      problems.push(`rubric[${i}]: has ${item.length} characters, the limit is ${MAX_RUBRIC_ITEM_CHARS}`);
      continue;
    }
    // I-4: the same criterion twice would count twice towards MIN_RUBRIC_ITEMS.
    const key = normalizedRubricItem(item);
    if (firstSeen.has(key)) problems.push(`rubric[${i}]: duplicates rubric[${firstSeen.get(key)}]`);
    else firstSeen.set(key, i);
    // I-5: a word that mixes scripts is a look-alike substitution, wherever the skill text is.
    if (mixesScripts(item)) {
      problems.push(`rubric[${i}]: has a word that mixes Latin letters with Cyrillic or Greek ones, which hides copied phrases from the quoting check; write each word in one script`);
    }
    if (skillRuns === null) continue;
    const words = wordsOf(item);
    if (hasSharedRun(words, skillRuns)) {
      problems.push(
        `rubric[${i}]: quotes ${RUBRIC_QUOTE_WORDS} or more consecutive words of the skill text; describe the expected outcome in other words`,
      );
    } else if (hasSharedRun(contentWordsOf(words), skillContentRuns)) {
      // I-5: the same copied phrase with small words added or dropped.
      problems.push(
        `rubric[${i}]: quotes ${RUBRIC_QUOTE_WORDS} or more consecutive words of the skill text once small words such as "the" and "of" are ignored; describe the expected outcome in other words`,
      );
    } else {
      // I-E: the same copied phrase with other words (not on the filler list) put between its words.
      const gapped = hasGappedRun(contentWordsOf(words), skillPositions, skillContentWords.length);
      if (gapped === null) {
        problems.push(
          `rubric[${i}]: could not be compared with the skill text for quoting within the limit of ${MAX_QUOTE_PAIRS} word pairs; shorten it or repeat fewer words`,
        );
      } else if (gapped) {
        problems.push(
          `rubric[${i}]: quotes ${RUBRIC_QUOTE_WORDS} or more words of the skill text in order, with at most ${QUOTE_GAP_WORDS} other words between two of them; describe the expected outcome in other words`,
        );
      }
    }
  }
}

/**
 * I-6: `target_section` must be a bounded, non-blank string, and when the skill text is supplied
 * it must be a heading of that text.
 */
function checkTargetSection(task, options, problems) {
  const section = task.target_section;
  if (!isNonBlankString(section)) {
    problems.push('target_section: must be a non-empty string');
    return;
  }
  if (section.length > MAX_TARGET_SECTION_CHARS) {
    // I-3
    problems.push(`target_section: has ${section.length} characters, the limit is ${MAX_TARGET_SECTION_CHARS}`);
    return;
  }
  const skillText = isObject(options) && typeof options.skillText === 'string' ? options.skillText : null;
  if (skillText !== null && !headingsOf(skillText).has(normalizedSection(section))) {
    problems.push(`target_section: ${echo(section)} is not a heading of the skill text`);
  }
}

function checkFixtures(task, problems) {
  if (!Array.isArray(task.fixtures)) {
    problems.push('fixtures: must be an array of relative paths');
    return;
  }
  if (task.fixtures.length > MAX_FIXTURES) {
    // C-4: counted before any entry is read.
    problems.push(`fixtures: has ${task.fixtures.length} entries, the limit is ${MAX_FIXTURES}`);
    return;
  }
  const seen = new Set();
  for (let i = 0; i < task.fixtures.length; i += 1) {
    const entry = task.fixtures[i];
    if (!isSafeRelativePath(entry)) {
      problems.push(`fixtures[${i}]: must be a relative path inside the workspace`);
    } else if (entry.length > MAX_PATH_CHARS) {
      // C-4: the same ceiling as a check's path.
      problems.push(`fixtures[${i}]: has ${entry.length} characters, the limit is ${MAX_PATH_CHARS}`);
    } else if (entry.split('/').some(isSkippedName)) {
      // I-A: the loader never reads `.git` or `node_modules`, so a fixture under either can never
      // be in a snapshot, and the declared starting point would not be the one linted. Same rule as
      // a check's path (checks.js `pathProblem`), through the same `isSkippedName`.
      problems.push(`fixtures[${i}]: it is under or named a directory the snapshot loader skips at any depth (.git, node_modules), so no snapshot can hold it; name a path the loader reads`);
    } else if (seen.has(entry)) {
      problems.push(`fixtures[${i}]: duplicate path ${echo(entry)}`);
    } else {
      seen.add(entry);
    }
  }
}

function checkChecks(task, problems) {
  if (!Array.isArray(task.checks)) {
    problems.push('checks: must be an array of check objects');
    return;
  }
  if (task.checks.length > MAX_CHECKS_PER_TASK) {
    // C-4: counted before any check is read or run.
    problems.push(`checks: has ${task.checks.length} checks, the limit is ${MAX_CHECKS_PER_TASK}`);
    return;
  }
  for (let i = 0; i < task.checks.length; i += 1) {
    const check = task.checks[i];
    if (!isObject(check)) {
      problems.push(`checks[${i}]: must be an object`);
      continue;
    }
    const found = validateCheck(check);
    for (const problem of found) problems.push(`checks[${i}]: ${problem}`);
    // The negative corpus is judged only on a well-formed check; otherwise its faults are already listed.
    if (found.length === 0) {
      for (const problem of validateNegatives(check)) problems.push(`checks[${i}]: ${problem}`);
    }
  }
}

function collectProblems(task, options) {
  if (!isObject(task)) return ['task: must be an object'];
  const problems = [];

  for (const key of Object.keys(task)) {
    if (!TASK_FIELDS.includes(key)) problems.push(`unknown field ${echo(key)}`);
  }
  for (const field of TASK_FIELDS) {
    if (!Object.hasOwn(task, field)) problems.push(`${field}: missing`);
  }

  checkSkillAndId(task, problems);

  if (Object.hasOwn(task, 'kind') && !KINDS.includes(task.kind)) {
    problems.push(`kind: must be one of ${KINDS.join(', ')}`);
  }

  if (Object.hasOwn(task, 'task')) {
    if (!isNonBlankString(task.task)) {
      problems.push('task: must be a non-empty string');
    } else if (task.task.length > MAX_TASK_CHARS) {
      // I-3: the word cap alone lets one huge token through, so the length is bounded first.
      problems.push(`task: has ${task.task.length} characters, the limit is ${MAX_TASK_CHARS}`);
    } else {
      const words = task.task.trim().split(/\s+/).length;
      if (words > MAX_TASK_WORDS) problems.push(`task: has ${words} words, the limit is ${MAX_TASK_WORDS}`);
    }
  }

  if (Object.hasOwn(task, 'rubric')) checkRubric(task, options, problems);

  if (Object.hasOwn(task, 'target_section')) checkTargetSection(task, options, problems);

  if (Object.hasOwn(task, 'fixtures')) checkFixtures(task, problems);
  if (Object.hasOwn(task, 'checks')) checkChecks(task, problems);

  // C-4: whatever the work budget refused to run is a check that was not made, and a task whose
  // checks were not all made is not valid. This holds even when no single problem above says so.
  const spent = exhaustionReason();
  if (spent !== null) problems.push(`task: validation ran out of its work budget (${spent}), so the task cannot be shown valid; simplify its patterns or declare fewer negatives`);

  return problems;
}

/**
 * Validates one task. Returns an array of problem strings, empty when the task is valid.
 * `options.skillText` (a string) turns on the rubric quoting rule. Never throws.
 * C-4: all pattern work is charged to one work budget, `options.budget` or a new one of
 * BUDGET_LIMITS.validation, or the budget of the caller when one is in force (a lint or a set).
 */
function validateTask(task, options) {
  try {
    return runWithBudget(options, 'validation', () => collectProblems(task, options));
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('options.budget')) return ['options.budget: must be a budget made by createBudget'];
    // A pre-parsed object can carry a getter that throws; report it instead of propagating.
    return ['task: could not be inspected because reading a property threw'];
  }
}

/** The task's id when it can be read as a string, else null. Never throws. */
function readId(task) {
  try {
    return isObject(task) && typeof task.id === 'string' ? task.id : null;
  } catch {
    return null;
  }
}

/** The skill text for `skill` from `options.skillTexts`, or undefined. Never throws. */
function skillTextFor(task, options) {
  try {
    const texts = isObject(options) ? options.skillTexts : undefined;
    const skill = isObject(task) ? task.skill : undefined;
    if (!isObject(texts) || typeof skill !== 'string' || !Object.hasOwn(texts, skill)) return undefined;
    return typeof texts[skill] === 'string' ? texts[skill] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * I-6: the problem for a task whose `target_section` cannot be resolved because the caller supplied
 * `options.skillTexts` but no text for the task's skill, or null. Never throws.
 */
function unresolvedSectionProblem(task, options) {
  try {
    if (!isObject(task) || !isObject(options) || !isObject(options.skillTexts)) return null;
    if (skillTextFor(task, options) !== undefined || !isNonBlankString(task.target_section)) return null;
    const skill = typeof task.skill === 'string' ? echo(task.skill) : 'its skill';
    return `target_section: cannot be resolved because options.skillTexts holds no text for ${skill}`;
  } catch {
    return null;
  }
}

/**
 * I-5: the problem for a task whose rubric cannot be checked for quoting because the caller
 * supplied `options.skillTexts` but no usable text for the task's skill, or null. The rule used to
 * be skipped in silence. A text with no visible content counts as no text, because it quotes
 * nothing. Never throws.
 */
function unresolvedQuotingProblem(task, options) {
  try {
    if (!isObject(task) || !isObject(options) || !isObject(options.skillTexts) || typeof task.skill !== 'string') return null;
    const text = skillTextFor(task, options);
    if (text !== undefined && isNonBlankString(text)) return null;
    return `rubric: the quoting rule cannot run because options.skillTexts holds no text for ${echo(task.skill)}`;
  } catch {
    return null;
  }
}

/**
 * I-5: the problem for an `options` object that names `skillTexts` but does not hold a plain
 * object there, for example `{ skillTexts: undefined }` from a lookup that found nothing. That is
 * a caller who meant to supply the texts, so skipping the rules would hide the mistake. Null when
 * the key is absent, which is the one way to ask for the rules to be skipped. Never throws.
 */
function invalidSkillTextsProblem(options) {
  try {
    if (!isObject(options) || !Object.hasOwn(options, 'skillTexts') || isObject(options.skillTexts)) return null;
    return 'options.skillTexts: must be a plain object from skill name to skill text; the rubric quoting rule and the target_section check were not run';
  } catch {
    return null;
  }
}

/**
 * Validates a list of tasks: each task on its own, plus the rule that ids are unique across the
 * set. Returns an array of problem strings, empty when the set is valid. `options.skillTexts`
 * turns on the rubric quoting rule per skill. Never throws.
 *
 * I-5: when `options.skillTexts` is supplied but is not an object, or holds no usable text for a
 * task's skill, that is a problem and not a silent skip. Leaving `skillTexts` out of `options`
 * entirely still skips both rules, as before.
 */
function validateTaskSet(tasks, options) {
  if (!Array.isArray(tasks)) return ['tasks: must be an array'];
  const problems = [];
  const firstUse = new Map();
  try {
    // C-4: one budget for the whole set (BUDGET_LIMITS.taskSet unless `options.budget` or an
    // enclosing budget is in force), so the total over the set is bounded and not only each task.
    runWithBudget(options, 'taskSet', () => collectSetProblems(tasks, options, problems, firstUse));
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('options.budget')) problems.push('options.budget: must be a budget made by createBudget');
    // An array-like proxy can throw while its elements are read.
    else problems.push('tasks: could not be inspected because reading an element threw');
  }
  return problems;
}

/** The body of `validateTaskSet`, run under its work budget. Appends to `problems` as it goes. */
function collectSetProblems(tasks, options, problems, firstUse) {
  const invalidTexts = invalidSkillTextsProblem(options);
  if (invalidTexts !== null) problems.push(invalidTexts);
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const label = `tasks[${i}]`;
    const skillText = skillTextFor(task, options);
    // Pass the key only when there is a text, so an absent text is an absent option.
    for (const problem of validateTask(task, skillText === undefined ? undefined : { skillText })) {
      problems.push(`${label}: ${problem}`);
    }
    const unresolved = unresolvedSectionProblem(task, options);
    if (unresolved !== null) problems.push(`${label}: ${unresolved}`);
    const unquoted = unresolvedQuotingProblem(task, options);
    if (unquoted !== null) problems.push(`${label}: ${unquoted}`);
    const id = readId(task);
    if (id === null) continue;
    if (firstUse.has(id)) problems.push(`${label}: id ${echo(id)} is already used by tasks[${firstUse.get(id)}]`);
    else firstUse.set(id, i);
  }
  // C-4: when the set's budget ran out, say so once for the set even if the task that spent it
  // reported its own problem.
  const spent = exhaustionReason();
  if (spent !== null) problems.push(`tasks: validation ran out of its work budget (${spent}), so the set cannot be shown valid`);
}

module.exports = {
  KINDS,
  TASK_FIELDS,
  MAX_TASK_WORDS,
  MAX_TASK_CHARS,
  MAX_RUBRIC_ITEM_CHARS,
  MAX_TARGET_SECTION_CHARS,
  MIN_RUBRIC_ITEMS,
  MAX_RUBRIC_ITEMS,
  MAX_FIXTURES,
  RUBRIC_QUOTE_WORDS,
  QUOTE_GAP_WORDS,
  validateTask,
  validateTaskSet,
};
