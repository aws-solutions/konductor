'use strict';

function parseText(text, source) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const wordCount = (text.match(/\S+/g) || []).length;
  return { source, lines, lineCount: lines.length, wordCount, characters: text.length };
}

module.exports = { parseText };
