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

// ---- lenient matching (opt-in) ----
// Judges often rebuild a quote: they drop table pipes and list markers, join fragments from different places with a
// space, a newline or an ellipsis, or wrap one verbatim sentence in their own prose. The lenient mode accepts these and
// still refuses a quote with a stretch of 20 or more letters that the output does not hold, or one whose found fragments
// cover under 60% of its letters.

const FRAGMENT_MIN_CHARS = 20; // a fragment this long (letters and digits) must be found; a shorter one is a connective
const INNER_QUOTE_MIN_CHARS = 40; // a quoted span of this length found verbatim makes the whole evidence good
const COVERAGE_MIN = 0.6; // the checked fragments must carry this share of the quote's letters and digits

const alnumCount = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;

// Words only: letters and digits. Table pipes and separator rows, list markers, heading and blockquote marks, escapes,
// ellipses and other punctuation all drop out, so layout a judge or a renderer adds or removes cannot cause a miss.
const wordsOf = (s) => normalize(s).match(/[\p{L}\p{N}]+/gu) || [];

// The quote cut into runs of words that the output holds in the same order (found from the end of the previous run).
// A run needs FRAGMENT_MIN_CHARS letters; words outside a run are connectives only while they stay under that length.
function runsOf(haystack, words) {
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
      at = found + cur.length + 1;
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

function lenientMatch(looseHaystack, quote) {
  const words = wordsOf(quote);
  const total = alnumCount(words.join(''));
  if (!total) return false;
  const { runs, longestLoose } = runsOf(looseHaystack, words);
  const covered = runs.reduce((n, r) => n + alnumCount(r), 0);
  if (runs.length && longestLoose < FRAGMENT_MIN_CHARS && covered / total >= COVERAGE_MIN) return true;
  return innerQuotes(quote).some((span) => {
    const inner = wordsOf(span).join(' ');
    return alnumCount(inner) >= INNER_QUOTE_MIN_CHARS && looseHaystack.includes(` ${inner} `);
  });
}

// Returns quote => boolean for one output; the output is normalized once. `lenient` also accepts the cases above; the
// strict rule is tried first, so a quote the default accepts is never refused.
function makeQuoteMatcher(outputText, { lenient = false } = {}) {
  const haystack = normalize(outputText);
  const looseHaystack = lenient ? ` ${wordsOf(outputText).join(' ')} ` : null;
  return (quote) => {
    const segments = segmentsOf(quote);
    if (segments.length && inOrder(haystack, segments)) return true;
    return lenient ? lenientMatch(looseHaystack, quote) : false;
  };
}

module.exports = { makeQuoteMatcher, normalize, segmentsOf, FRAGMENT_MIN_CHARS, INNER_QUOTE_MIN_CHARS };
