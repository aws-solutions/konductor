'use strict';

const { splitLines } = require('../support/text-tools');
const { wordsIn } = require('../support/word-count');

function countText(text) {
  const lines = splitLines(text);
  return { lines: lines.length, words: wordsIn(text) };
}
module.exports = { countText };
