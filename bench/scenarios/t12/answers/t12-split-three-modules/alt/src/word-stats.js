'use strict';

// See docs/specs/word-stats.md.
const DEFAULT_TOP = 3;
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;
const SENTENCE = /[^.!?]+/g;
const HAS_WORD = /[\p{L}\p{N}]/u;

const byCountThenWord = ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0);

function wordStats(text, { top = DEFAULT_TOP } = {}) {
  if (typeof text !== 'string') throw new TypeError('wordStats: expected a string');
  const words = Array.from(text.matchAll(WORD), (m) => m[0].toLowerCase());
  const counts = words.reduce((acc, w) => acc.set(w, (acc.get(w) || 0) + 1), new Map());
  const longest = words.reduce((best, w) => (best === null || w.length > best.length ? w : best), null);
  const sentences = (text.match(SENTENCE) || []).filter((part) => HAS_WORD.test(part)).length;
  return { words: words.length, unique: counts.size, sentences, longest, top: [...counts.entries()].sort(byCountThenWord).slice(0, top) };
}

module.exports = { wordStats };
