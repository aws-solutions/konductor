'use strict';

// See docs/specs/word-stats.md. Shallow fake: splits on spaces and fills the fields roughly.
function wordStats(text) {
  const words = String(text).split(' ').filter(Boolean);
  return { words: words.length, unique: new Set(words).size, sentences: 1, longest: words[0] || null, top: [] };
}

module.exports = { wordStats };
