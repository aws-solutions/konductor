'use strict';

const { splitLines } = require('../support/text-tools');
const rules = require('../support/rules');

function checkText(text) {
  const lines = splitLines(text);
  const issues = lines.filter((line) => !rules.acceptable(line)).length;
  return { ok: lines.length > 0 && issues === 0, issues };
}
module.exports = { checkText };
