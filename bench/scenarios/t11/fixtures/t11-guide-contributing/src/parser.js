'use strict';
const { tokenize } = require('./tokenizer');
function parse(input) {
  if (typeof input !== 'string') throw new TypeError('cue input must be text');
  return tokenize(input).map((line, index) => {
    const match = /^(\d{2}:\d{2}:\d{2})\s+([^|]+?)(?:\s*\|\s*(.*))?$/.exec(line);
    if (!match) return { line: index + 1, raw: line, error: 'expected timestamp and text' };
    return { line: index + 1, at: match[1], text: match[2].trim(), label: match[3]?.trim() || null };
  });
}
module.exports = { parse };
