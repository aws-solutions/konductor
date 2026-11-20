'use strict';

// Hidden test of t12-delegated-worker-fix: each issue fixed by its own worker on its own branch, reviewed, merged
// with its own merge commit and cleaned up, read from the repository only (bench/scenarios/lib/hidden/git-work.js).
const test = require('node:test');
const { workTests } = require('./git-work.js');

workTests(test, { root: __dirname, ...require('./work.json') });
