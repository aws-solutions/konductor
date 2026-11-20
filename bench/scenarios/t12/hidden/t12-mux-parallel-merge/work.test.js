'use strict';

// Hidden test of t12-mux-parallel-merge: three disjoint tickets done side by side by workers on their own branches,
// merged with one merge commit each and cleaned up, read from the repository only (bench/scenarios/lib/hidden/git-work.js).
// work.json and hidden-tests/ come from the second-family author's key step; this file is the batch's glue.
const test = require('node:test');
const { workTests } = require('./git-work.js');

workTests(test, { root: __dirname, ...require('./work.json') });
