'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { lint } = require('./policy-lint');
const { POLICY_FILES } = require('./policy-files');
const { summarize, formatSummary } = require('./summary');

const root = path.resolve(__dirname, '..');
const account = JSON.parse(fs.readFileSync(path.join(root, 'config', 'account.json'), 'utf8'));
const errors = [];

for (const relative of POLICY_FILES) {
  const file = path.join(root, relative);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    continue;
  }
  for (const problem of lint(document)) errors.push(`${relative}: ${problem}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(formatSummary(summarize(account, POLICY_FILES.length)));
  console.log('Status: OK');
}
