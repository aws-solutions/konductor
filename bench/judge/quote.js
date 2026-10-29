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

// Returns quote => boolean for one output; the output is normalized once.
function makeQuoteMatcher(outputText) {
  const haystack = normalize(outputText);
  return (quote) => {
    const segments = segmentsOf(quote);
    if (!segments.length) return false;
    let at = 0;
    for (const seg of segments) {
      const i = haystack.indexOf(seg, at);
      if (i < 0) return false;
      at = i + seg.length;
    }
    return true;
  };
}

module.exports = { makeQuoteMatcher, normalize, segmentsOf };
