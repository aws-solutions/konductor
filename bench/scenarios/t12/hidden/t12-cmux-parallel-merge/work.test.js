'use strict';

// Hidden test of t12-cmux-parallel-merge: three tickets done side by side by workers on their own branches, merged
// with one merge commit each (two of them share the command registry and the CLI test) and cleaned up, read from
// the repository only (bench/scenarios/lib/hidden/git-work.js).
const test = require('node:test');
const { workTests } = require('./git-work.js');

workTests(test, { root: __dirname, ...require('./work.json') });
