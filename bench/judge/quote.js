// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks that an evidence quote from a judge really comes from the graded output.
// Judges often shorten a quote with "..." or reflow whitespace and markdown, so a verbatim
// substring test rejects honest quotes. A quote is accepted when every non-trivial segment
// between ellipses appears in the output, in order, after whitespace, case, quote-mark and
// markdown-emphasis normalization. An invented or reordered quote is still rejected.

const ELLIPSIS = /\.\.\.|\u2026/;
const MIN_SEGMENT_CHARS = 3;

function normalize(s) {
  return String(s)
    .toLowerCase()
    .replace(/["'\u201c\u201d\u2018\u2019]/g, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Edge punctuation is dropped so "[...]" or a trailing period from a shortened quote cannot cause a miss.
const trimEdges = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const isTrivial = (seg) => (seg.match(/[\p{L}\p{N}]/gu) || []).length < MIN_SEGMENT_CHARS;

function segmentsOf(quote) {
  return String(quote).split(ELLIPSIS).map((seg) => trimEdges(normalize(seg))).filter((seg) => !isTrivial(seg));
}

const inOrder = (haystack, segments) => {
  let at = 0;
  for (const seg of segments) {
    const i = haystack.indexOf(seg, at);
    if (i < 0) return false;
    at = i + seg.length;
  }
  return true;
};

// ---- lenient matching (the default rule) ----
// Judges often rebuild a quote: they drop table pipes and list markers, join fragments from different places with a
// space, a newline or an ellipsis, or wrap one verbatim sentence in their own prose. The lenient rule accepts these and
// still refuses a quote with a stretch of 20 or more letters that the output does not hold, one whose found fragments
// cover under 60% of its letters, and any quote that has 20 or more unsupported letters in all (see unsupportedLetters).

const FRAGMENT_MIN_CHARS = 20; // a fragment this long (letters and digits) must be found; a shorter one is a connective
const INNER_QUOTE_MIN_CHARS = 40; // a quoted span of this length found verbatim makes the whole evidence good
const COVERAGE_MIN = 0.6; // the checked fragments must carry this share of the quote's letters and digits
const MAX_UNSUPPORTED_LETTERS = 20; // a quote with this many letters or more that the output does not support is refused, by either path

// A judge pass records the strict and lenient views; 'paraphrase' and 'paraphrase-guarded' are report-time views rebuilt
// from the saved outputs.
const JUDGE_QUOTE_RULES = ['strict', 'lenient'];
const QUOTE_RULES = [...JUDGE_QUOTE_RULES, 'paraphrase', 'paraphrase-guarded'];
const DEFAULT_QUOTE_RULE = 'lenient';
const RULE_TEXT = {
  strict: 'strict (every segment between ellipses must appear in the output, in order)',
  lenient: `lenient (tightened: quotes with ${MAX_UNSUPPORTED_LETTERS} or more unsupported letters are rejected)`,
  paraphrase: 'paraphrase (lenient, or a restatement whose figures and most content words are in the output)',
  'paraphrase-guarded': 'paraphrase-guarded (paraphrase, but every figure must be in the output and a copy of the rubric text is refused)',
};

const alnumCount = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;

// Words only: letters and digits. Table pipes and separator rows, list markers, heading and blockquote marks, escapes,
// ellipses and other punctuation all drop out, so layout a judge or a renderer adds or removes cannot cause a miss.
const wordsOf = (s) => normalize(s).match(/[\p{L}\p{N}]+/gu) || [];

// The quote cut into runs of words that the output holds in the same order (found from the end of the previous run).
// A run needs FRAGMENT_MIN_CHARS letters; words outside a run are connectives only while they stay under that length.
function runsOf(haystack, words, { ordered = true } = {}) {
  const runs = [];
  let at = 0;
  let loose = 0;
  let longestLoose = 0;
  let i = 0;
  while (i < words.length) {
    let cur = '';
    let end = -1;
    let found = -1;
    for (let j = i; j < words.length; j++) {
      const next = cur ? `${cur} ${words[j]}` : words[j];
      const at2 = haystack.indexOf(` ${next} `, at);
      if (at2 < 0) break;
      cur = next; end = j; found = at2;
    }
    if (end >= i && alnumCount(cur) >= FRAGMENT_MIN_CHARS) {
      runs.push(cur);
      at = ordered ? found + cur.length + 1 : 0;
      i = end + 1;
      longestLoose = Math.max(longestLoose, loose);
      loose = 0;
    } else {
      loose += alnumCount(words[i]);
      i++;
    }
  }
  return { runs, longestLoose: Math.max(longestLoose, loose) };
}

function innerQuotes(quote) {
  const out = [];
  for (const m of String(quote).matchAll(/"([^"\n]+)"|\u201c([^\u201d\n]+)\u201d|`([^`\n]+)`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Letters and digits of the quote that the output does not support: those outside every run of 20 or more letters that the
 * output holds, with each run looked up anywhere in the output (order ignored). A word that is in the output but only in a
 * stretch shorter than 20 letters counts as unsupported, which is the stricter reading.
 */
function unsupportedLetters(looseHaystack, quote) {
  const words = wordsOf(quote);
  const total = alnumCount(words.join(''));
  const { runs } = runsOf(looseHaystack, words, { ordered: false });
  return total - runs.reduce((n, r) => n + alnumCount(r), 0);
}

function lenientMatch(looseHaystack, quote) {
  const words = wordsOf(quote);
  const total = alnumCount(words.join(''));
  if (!total) return false;
  const { runs, longestLoose } = runsOf(looseHaystack, words);
  const covered = runs.reduce((n, r) => n + alnumCount(r), 0);
  const byFragments = runs.length > 0 && longestLoose < FRAGMENT_MIN_CHARS && covered / total >= COVERAGE_MIN;
  const accepted = byFragments || innerQuotes(quote).some((span) => {
    const inner = wordsOf(span).join(' ');
    return alnumCount(inner) >= INNER_QUOTE_MIN_CHARS && looseHaystack.includes(` ${inner} `);
  });
  return accepted && unsupportedLetters(looseHaystack, quote) < MAX_UNSUPPORTED_LETTERS;
}

// ---- paraphrase matching (the opt-in rule 'paraphrase') ----
// A judge that restates a point in its own words instead of copying it is not inventing it when the output holds what
// the restatement says. Tried only after the lenient rule refused the evidence. It is accepted when every figure in it (a
// number of two or more digits, decimals kept, thousands commas dropped) is in the output and at least
// PARAPHRASE_WORDS_MIN of its content words (4 or more letters, outside a short list of judge phrasing) are too; evidence
// with no figure needs PARAPHRASE_WORDS_BARE of them and at least PARAPHRASE_MIN_WORDS content words. A cited line number
// must exist in the output. A restatement whose figures or most words the output lacks, or "(nothing in the output)", fails.

const PARAPHRASE_WORDS_MIN = 0.5;
const PARAPHRASE_WORDS_BARE = 0.75;
const PARAPHRASE_MIN_WORDS = 6;
const JUDGE_WORDS = new Set(('output answer document states stated claims claimed says mentions mentioned notes noted explains explained '
  + 'shows showed correctly incorrectly does doesn that this with from have been were they their them than then into only also '
  + 'which while where what when about over under more most some such each other these those there here because response '
  + 'agent author write writes wrote section line lines heading table block').split(' '));

const figuresOf = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '')).filter((n) => n.replace(/\D/g, '').length >= 2);
const citedLinesOf = (s) => [...String(s).matchAll(/\blines?\s+(\d+)/gi)].map((m) => Number(m[1]));
// The figures evidence names, without the line numbers it cites ("line 12").
const evidenceFiguresOf = (s) => { const cited = citedLinesOf(s); return figuresOf(s).filter((n) => !cited.includes(Number(n))); };
// Words are compared on a crude stem (a trailing "s" or "es" dropped), so "partition" matches "partitions".
const stem = (w) => (w.length > 4 ? w.replace(/(?:es|s)$/, '') : w);
const contentWords = (s) => wordsOf(s).filter((w) => w.length >= 4 && !/^\d/.test(w) && !JUDGE_WORDS.has(w)).map(stem);

function paraphraseMatch(outputText, evidence) {
  const out = String(outputText);
  const figures = new Set(figuresOf(out));
  const lines = out.split('\n').length;
  const cited = citedLinesOf(evidence);
  if (cited.some((n) => n < 1 || n > lines)) return false;
  const evFigures = evidenceFiguresOf(evidence);
  if (evFigures.some((n) => !figures.has(n))) return false;
  const words = contentWords(evidence);
  const outWords = new Set(wordsOf(out).map(stem));
  const share = words.length ? words.filter((w) => outWords.has(w)).length / words.length : 0;
  if (evFigures.length) return words.length > 0 && share >= PARAPHRASE_WORDS_MIN;
  return words.length >= PARAPHRASE_MIN_WORDS && share >= PARAPHRASE_WORDS_BARE;
}

// Returns quote => boolean for one output; the output is normalized once. `lenient` also accepts the cases above; the
// strict rule is tried first, so a quote the strict rule accepts is never refused. The argument defaults to strict so a
// caller that wants the pack's rule says nothing; the judge passes the rule it resolved (DEFAULT_QUOTE_RULE unless told).
// `paraphrase` (implies lenient) also accepts a faithful restatement (paraphraseMatch).
// `guarded` (the 'paraphrase-guarded' rule; implies paraphrase) adds two checks to the loose paths, never to strict:
// - figure guard: evidence that names a figure the output lacks is refused, on the lenient path too. The lenient rule
//   alone lets a changed figure through when it is a small share of a long quote (on the first judged T3 wave, 122 of 398
//   quotes with every figure shifted were accepted).
// - rubric-copy guard: evidence the lenient rule cannot find in the output but finds in the criterion's own text (the
//   second argument) is the judge pasting the rubric's anchor, not citing the output, and is refused.
// The rubric text is optional; without it only the figure guard applies.
function makeQuoteMatcher(outputText, { lenient = false, paraphrase = false, guarded = false } = {}) {
  const haystack = normalize(outputText);
  const loose = lenient || paraphrase || guarded;
  const looseHaystack = loose ? ` ${wordsOf(outputText).join(' ')} ` : null;
  const outFigures = guarded ? new Set(figuresOf(outputText)) : null;
  const figuresHeld = (quote) => evidenceFiguresOf(quote).every((n) => outFigures.has(n));
  return (quote, criterionText) => {
    const segments = segmentsOf(quote);
    if (segments.length && inOrder(haystack, segments)) return true;
    if (loose && lenientMatch(looseHaystack, quote)) return !guarded || figuresHeld(quote);
    if (!(paraphrase || guarded) || !paraphraseMatch(outputText, quote)) return false;
    return !guarded || !copiedFromRubric(criterionText, quote);
  };
}

/** True when the lenient rule finds `quote` in the criterion's own text: the judge copied the rubric, not the output. */
function copiedFromRubric(criterionText, quote) {
  if (!criterionText) return false;
  return lenientMatch(` ${wordsOf(criterionText).join(' ')} `, quote) || inOrder(normalize(criterionText), segmentsOf(quote));
}

module.exports = { makeQuoteMatcher, paraphraseMatch, copiedFromRubric, evidenceFiguresOf, normalize, segmentsOf, unsupportedLetters, wordsOf, FRAGMENT_MIN_CHARS, INNER_QUOTE_MIN_CHARS, MAX_UNSUPPORTED_LETTERS, QUOTE_RULES, JUDGE_QUOTE_RULES, DEFAULT_QUOTE_RULE, RULE_TEXT };
