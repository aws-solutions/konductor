'use strict';

const { splitLines } = require('../support/text-tools');
const { normalizeLine } = require('../support/format-rules');

function formatText(text) {
  return { lines: splitLines(text).map(normalizeLine).length };
}
module.exports = { formatText };
