'use strict';

const { checkText } = require('./check-engine');

function makeReport(header, file, text) {
  const status = checkText(text).ok ? 'clean' : 'issues found';
  return `${header}
file: ${file}
status: ${status}`;
}
module.exports = { makeReport };
