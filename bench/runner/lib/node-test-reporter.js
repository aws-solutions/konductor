// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reporter for `node --test --test-reporter=<this file>`. Prints one `@@T {json}` line per finished
// test (suite records are skipped) so a run can be compared with a list of test ids. Nothing else is
// written to stdout. Each file keeps its own name stack because files run concurrently.

const path = require('node:path');

module.exports = async function* nodeTestJsonReporter(source) {
  const stacks = new Map();
  for await (const ev of source) {
    if (ev.type !== 'test:start' && ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data;
    const names = stacks.get(d.file) || [];
    names.length = d.nesting;
    names[d.nesting] = d.name;
    stacks.set(d.file, names);
    if (ev.type === 'test:start' || d.details?.type === 'suite') continue;
    const file = d.file ? path.relative(process.cwd(), d.file).split(path.sep).join('/') : '';
    const status = ev.type === 'test:pass' && !d.skip && !d.todo ? 'pass' : 'fail';
    yield `@@T ${JSON.stringify({ file, path: names.slice(0, d.nesting + 1), status })}\n`;
  }
};
