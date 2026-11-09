// SPDX-License-Identifier: Apache-2.0
'use strict';

const MIN_QUOTE_CHARS = 20;

// Whitespace, emphasis marks and curly quotes do not count as differences.
const norm = (s) => String(s)
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/** Joins the normalized lines with single spaces and remembers where each line starts. */
function indexLines(text) {
  let joined = '';
  const starts = [];
  String(text).split('\n').forEach((line, i) => {
    const n = norm(line);
    if (!n) return;
    if (joined) joined += ' ';
    starts.push({ line: i + 1, at: joined.length });
    joined += n;
  });
  return { joined, starts };
}

/** {ok, line} when the quote appears in the skill text; {ok:false, reason} otherwise. */
function verifyQuote(skillText, quote) {
  const q = norm(quote ?? '');
  if (q.length < MIN_QUOTE_CHARS) return { ok: false, reason: `quote shorter than ${MIN_QUOTE_CHARS} characters` };
  const { joined, starts } = indexLines(skillText);
  const at = joined.indexOf(q);
  if (at < 0) return { ok: false, reason: 'quote not found in the skill text' };
  let line = starts[0].line;
  for (const s of starts) if (s.at <= at) line = s.line; else break;
  return { ok: true, line };
}

module.exports = { verifyQuote, norm, MIN_QUOTE_CHARS };
