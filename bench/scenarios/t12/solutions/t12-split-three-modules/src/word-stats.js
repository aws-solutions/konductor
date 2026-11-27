'use strict';

// See docs/specs/word-stats.md.
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

function wordStats(text, { top = 3 } = {}) {
  if (typeof text !== 'string') throw new TypeError('wordStats: text must be a string');
  const words = (text.match(WORD) ?? []).map((w) => w.toLowerCase());
  const counts = new Map();
  let longest = null;
  for (const w of words) {
    counts.set(w, (counts.get(w) ?? 0) + 1);
    if (longest === null || w.length > longest.length) longest = w;
  }
  const sentences = text.split(/[.!?]+/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { words: words.length, unique: counts.size, sentences, longest, top: ranked.slice(0, top) };
}

module.exports = { wordStats };
