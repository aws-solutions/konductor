// SPDX-License-Identifier: Apache-2.0
'use strict';

// Deterministic task checks, evaluated against the final workspace of a run.

const path = require('node:path');
const { evalCheck } = require('./check-matcher.js');

function runCheck(root, check, opts = {}) {
  const base = { type: check.type };
  for (const k of ['path', 'pattern', 'cmd', 'min', 'labels']) if (check[k] !== undefined) base[k] = check[k];
  try {
    const { passed, detail, tests } = evalCheck(root, check, opts);
    return { ...base, passed, detail, ...(tests ? { tests } : {}) };
  } catch (err) {
    return { ...base, passed: false, detail: err.message };
  }
}

// opts: {pristineDir, env, wrapCmd}, see check-matcher.evalCheck.
function runChecks(root, checks, opts = {}) {
  const absRoot = path.resolve(root);
  return (checks || []).map((c) => runCheck(absRoot, c, opts));
}

module.exports = { runChecks, runCheck };
