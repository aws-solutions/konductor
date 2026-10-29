'use strict';

function countWords(text) {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

function longestWord(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let best = '';
  for (const w of words) {
    if (w.length > best.length) best = w;
  }
  return best;
}

module.exports = { countWords, longestWord };
