// SPDX-License-Identifier: Apache-2.0
/**
 * Missing-or-unused-skill narration, as one class of sentences. Pure: no file, network or clock access, no state.
 *
 * The with arm is told to load a skill. When none loads or matches, it says so ("No skill could be found."). The
 * without arm has no skill concept and rarely writes that. A judge who reads such a sentence learns the arm, so the
 * sanitizer drops it and the leak scan flags it, with one text-only rule for both arms (sanitize.js, judge-input.js).
 *
 * This narration varies on three axes at once: the negation (no, none, not, n't, unable, without), the lookup word
 * (found, locate, match, apply, relevant, available, load, use) and the order and filler between them. A fixed phrase
 * per wording closes the sentences someone listed and leaves their neighbours. This rule asks for two independent cues
 * close together, in any order, so a new wording gets past it only by avoiding every cue word.
 *
 * A sentence is narration when it has the noun "skill" or "skills" (NOUN) and, in the same clause and close to it:
 *   C. an absence word on its own        "Skill unavailable." "The requested skill was missing."
 *   A. a negation and a lookup word      "No skill could be found." "None of the skills applied."
 *   B. a first-person narrator and a negation or a lookup verb
 *                                        "I checked for a skill." "I went ahead without a skill."
 * "Close" is counted in content words: articles, auxiliary verbs and the negation words themselves do not count.
 * A clause ends at ";". No cue is looked for past WINDOW.span words, whatever those words are.
 *
 * Cost is linear in the length of the sentence. There is no backtracking pattern: one global pass cuts the sentence
 * into words (each character is consumed once), and every noun then reads at most a fixed number of words on each side.
 * The clause start is tracked while walking the words, not searched for from each noun, because a search back to it
 * for every noun made a long run of "the skill the skill ..." quadratic.
 *
 * What the rule cannot see is kept on purpose or is a known gap. "No skill is needed for this step." has a negation and
 * no lookup word, so it stays: it is ordinary prose. "Skill: none" and narration that never says "skill" ("I answered
 * directly.") pass. A sentence that says "I have no skill in cooking." is dropped, because first-person talk about
 * skills cannot be told from the arm's narration; that costs one sentence.
 */
'use strict';

/**
 * Words after "skill" that make it a human-resources or training noun ("skill levels", "skills matrix"). A regex
 * source, shared with the sanitizer's own SKILLWORD so the two cannot disagree.
 */
const SKILL_DOMAIN_NEXT =
  'levels?|gaps?|matrix|assessment|inventory|development|training|requirements?|mix|shortage|frameworks?|taxonomy';

const WORDS = Object.freeze({
  // Negation. `n't` endings are negations too (NEGATION_ENDING).
  negationDeterminers: ['no', 'none', 'nothing', 'neither', 'nor', 'zero'],
  negationVerbs: [
    'not',
    'never',
    'without',
    'cannot',
    'unable',
    'fail',
    'fails',
    'failed',
  ],
  // Absence words. The first group counts on either side of the noun, the second only after it ("The skill was
  // missing", not "Missing skills hurt a team").
  absentEitherSide: ['unavailable', 'nonexistent', 'uninstalled'],
  absentAfter: ['missing', 'absent'],
  // Regex sources for whole words, one inflection family per entry.
  lookVerbs: [
    'find|finds|finding|found',
    'locat(?:e|es|ed|ing)',
    'identif(?:y|ies|ied|ying)',
    'discover(?:s|ed|ing)?',
    'look(?:s|ed|ing)?|lookups?',
    'search(?:es|ed|ing)?',
    'check(?:s|ed|ing)?',
    'match(?:es|ed|ing)?',
    'appl(?:y|ies|ied|ying)',
    'fits?|fitted',
    'suit(?:s|ed)?',
    'exist(?:s|ed|ing)?',
    'install(?:s|ed)?',
    'load(?:s|ed|ing)?',
    'invok(?:e|es|ed|ing)',
    'activat(?:e|es|ed|ing)',
    'trigger(?:s|ed|ing)?',
    'select(?:s|ed|ing)?',
    'choos(?:e|es|ing)|chos(?:e|en)',
    'pick(?:s|ed)?',
    'us(?:e|es|ed|ing)',
    'try|tries|tried|trying',
    'consult(?:s|ed|ing)?',
    'scan(?:s|ned|ning)?',
    'browse|browsed|browsing',
    'see|saw|seen',
  ],
  // Words that read as a lookup result next to a negation ("No relevant skill applied").
  lookAdjectives: [
    'relevant',
    'applicable',
    'appropriate',
    'suitable',
    'available',
    'matching',
    'installed',
  ],
  // First person. "let me" is one word (tokenize); a bare "me", "my", "our" or "us" is not a narrator ("My edits had no
  // effect").
  narrators: [
    'i',
    "i'm",
    "i've",
    "i'll",
    "i'd",
    'we',
    "we're",
    "we've",
    "we'll",
    "we'd",
    "let's",
    'let me',
  ],
  // A clause that opens with one of these is narration when the noun follows soon ("Checking for available skills.").
  seekGerunds: [
    'checking',
    'searching',
    'looking',
    'scanning',
    'browsing',
    'locating',
  ],
  // Words that do not count toward a distance.
  skipped: [
    'a',
    'an',
    'the',
    'any',
    'this',
    'that',
    'these',
    'those',
    'some',
    'of',
    'is',
    'are',
    'was',
    'were',
    'be',
    'been',
    'being',
    'am',
    'could',
    'can',
    'would',
    'will',
    'did',
    'does',
    'do',
    'has',
    'have',
    'had',
    'should',
    'may',
    'might',
    'must',
    'shall',
  ],
});

/** How far a cue may be from the noun, in counted words, plus the caps that keep the cost bounded. */
const WINDOW = Object.freeze({
  absence: 2,
  negation: 4,
  lookup: 2,
  narrator: 4,
  narratorLookup: 3,
  // How soon after the start of its clause the noun must come for a clause that opens with a seeking gerund.
  gerundStart: 6,
  // The most raw words read on each side of a noun, however many of them are skipped. Bounds the cost per noun.
  span: 12,
});

/** A word: letters and digits, with inner apostrophes and hyphens kept ("couldn't", "skill-based"), or a ";". */
const TOKEN_SOURCE =
  "[\\p{L}\\p{N}]+(?:['\\u2019][\\p{L}]+)*(?:-[\\p{L}\\p{N}]+)*|;";
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Everything the matcher depends on, as data, so the sanitizer's provenance hash covers it. */
const SKILL_CLASS_SPEC = Object.freeze({
  words: WORDS,
  window: WINDOW,
  token: TOKEN_SOURCE,
  domain_next: SKILL_DOMAIN_NEXT,
});

const CLAUSE_END = ';';
const wholeWord = (sources) => new RegExp(`^(?:${sources.join('|')})$`);
const NEGATION = wholeWord([
  ...WORDS.negationDeterminers,
  ...WORDS.negationVerbs,
]);
const NEGATION_ENDING = /n't$/;
const ABSENT_EITHER_SIDE = wholeWord(WORDS.absentEitherSide);
const ABSENT_AFTER = wholeWord(WORDS.absentAfter);
const LOOK_VERB = wholeWord(WORDS.lookVerbs);
const LOOK_WORD = wholeWord([...WORDS.lookVerbs, ...WORDS.lookAdjectives]);
const NARRATOR = wholeWord(WORDS.narrators);
const DOMAIN_NEXT = wholeWord([SKILL_DOMAIN_NEXT]);
const NOUN = /^skills?$/;
const SKIPPED = new Set(WORDS.skipped);
const SEEK_GERUNDS = new Set(WORDS.seekGerunds);
const TOKEN = new RegExp(TOKEN_SOURCE, 'gu');

const isNegation = (word) => NEGATION.test(word) || NEGATION_ENDING.test(word);
const isAbsentEitherSide = (word) => ABSENT_EITHER_SIDE.test(word);
const isAbsentAfter = (word) => ABSENT_AFTER.test(word);
const isLookVerb = (word) => LOOK_VERB.test(word);
const isLookWord = (word) => LOOK_WORD.test(word);
const isNarrator = (word) => NARRATOR.test(word);

/** The words of a sentence, lower-cased, with the curly apostrophe made straight, and ";" kept as a clause end. */
function tokenize(sentence) {
  const words = [];
  for (const match of sentence.matchAll(TOKEN)) {
    const word = match[0].toLowerCase().replace(/\u2019/g, "'");
    if (word === 'me' && words[words.length - 1] === 'let')
      words[words.length - 1] = 'let me';
    else words.push(word);
  }
  return words;
}

/**
 * Is a word that passes `test` within `reach` counted words of `words[at]`, walking in direction `step` (-1 or 1) and
 * staying in the clause? Skipped words and negations are walked over without counting, up to WINDOW.span words.
 */
function findWord(words, at, step, reach, test) {
  let counted = 0;
  for (
    let k = at + step;
    k >= 0 &&
    k < words.length &&
    words[k] !== CLAUSE_END &&
    Math.abs(k - at) <= WINDOW.span;
    k += step
  ) {
    if (test(words[k])) return true;
    if (!SKIPPED.has(words[k]) && !isNegation(words[k]) && ++counted >= reach)
      return false;
  }
  return false;
}
const findNear = (words, at, reach, test) =>
  findWord(words, at, -1, reach, test) || findWord(words, at, 1, reach, test);

/** Is `words[at]` the noun in a sense other than "skill levels" and "skills matrix"? */
const isSkillNoun = (words, at) =>
  NOUN.test(words[at]) &&
  !(at + 1 < words.length && DOMAIN_NEXT.test(words[at + 1]));

/** True when the sentence is missing-or-unused-skill narration. */
function isSkillAbsenceNarration(sentence) {
  const words = tokenize(sentence);
  let clauseStart = 0;
  for (let at = 0; at < words.length; at++) {
    if (words[at] === CLAUSE_END) clauseStart = at + 1;
    if (!isSkillNoun(words, at)) continue;
    // C: an absence word on its own.
    if (
      findNear(words, at, WINDOW.absence, isAbsentEitherSide) ||
      findWord(words, at, 1, WINDOW.absence, isAbsentAfter)
    )
      return true;
    // A: a negation and a lookup word.
    const hasNegation = findNear(words, at, WINDOW.negation, isNegation);
    if (hasNegation && findNear(words, at, WINDOW.lookup, isLookWord))
      return true;
    // B: a narrator, and a negation or a lookup verb.
    const opensWithSeek =
      clauseStart < at &&
      at - clauseStart <= WINDOW.gerundStart &&
      SEEK_GERUNDS.has(words[clauseStart]);
    const hasNarrator =
      opensWithSeek || findNear(words, at, WINDOW.narrator, isNarrator);
    if (
      hasNarrator &&
      (hasNegation || findNear(words, at, WINDOW.narratorLookup, isLookVerb))
    )
      return true;
  }
  return false;
}

/** The sentences of `text` (any number of lines) that are narration, split the way the sanitizer splits a line. */
function findSkillAbsenceNarration(text) {
  const found = [];
  for (const line of String(text).split('\n'))
    for (const sentence of line.trimStart().split(SENTENCE_SPLIT))
      if (isSkillAbsenceNarration(sentence)) found.push(sentence);
  return found;
}

module.exports = {
  SKILL_CLASS_SPEC,
  SKILL_DOMAIN_NEXT,
  SENTENCE_SPLIT,
  tokenize,
  isSkillAbsenceNarration,
  findSkillAbsenceNarration,
};
