// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tolerant checks must still reject plausible wrong answers. tasks/negatives/<task-id>.json
// lists documents to lay over the reference solution and says whether one given check must
// pass or fail on them:
//   { "loosened": [1, 4],
//     "cases": [{ "name": "...", "check": 1, "type": "contains", "expect": "pass" | "fail",
//                 "files": { "path/in/workspace": "content" } }] }
// Every index in "loosened" needs at least MIN_NEGATIVES failing cases and one passing case.

const fs = require('node:fs');
const path = require('node:path');

const MIN_NEGATIVES = 2;

function loadCases(negativesDir, taskId) {
  const file = path.join(negativesDir, `${taskId}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// makeWorkspace() returns a fresh directory holding fixture plus reference solution.
// evalOne(dir, check) returns true when the check passes. Returns a list of problems.
function checkCases({ task, spec, makeWorkspace, evalOne }) {
  const problems = [];
  const at = (c) => `negatives/${task.id}.json case "${c.name}"`;
  const cases = Array.isArray(spec?.cases) ? spec.cases : [];
  for (const c of cases) {
    const check = task.checks[c.check];
    if (!check) { problems.push(`${at(c)}: no check at index ${c.check}`); continue; }
    if (check.type !== c.type) { problems.push(`${at(c)}: check ${c.check} is ${check.type}, case says ${c.type}`); continue; }
    if (!['pass', 'fail'].includes(c.expect)) { problems.push(`${at(c)}: expect must be pass or fail`); continue; }
    const dir = makeWorkspace();
    try {
      for (const [rel, text] of Object.entries(c.files || {})) {
        const full = path.resolve(dir, rel);
        if (!full.startsWith(dir + path.sep)) throw new Error(`path escapes workspace: ${rel}`);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
      }
      const passed = evalOne(dir, check);
      if (passed !== (c.expect === 'pass')) problems.push(`${at(c)}: check ${c.check} ${passed ? 'passed' : 'failed'}, expected ${c.expect}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const idx of spec?.loosened || []) {
    const mine = cases.filter((c) => c.check === idx);
    if (mine.filter((c) => c.expect === 'fail').length < MIN_NEGATIVES) problems.push(`negatives/${task.id}.json: loosened check ${idx} needs at least ${MIN_NEGATIVES} negative cases`);
    if (!mine.some((c) => c.expect === 'pass')) problems.push(`negatives/${task.id}.json: loosened check ${idx} needs at least one positive case`);
  }
  return problems;
}

module.exports = { loadCases, checkCases, MIN_NEGATIVES };
