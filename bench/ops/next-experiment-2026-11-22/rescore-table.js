#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Per-run code scores of the re-score copies rescore-cc.sh (and the workspace rescore.sh) made: saved (the owner's result.json checks, kept under
// checksOriginal by the recheck), before (frozen bench and key, rechecked) and after (fixed key). Scores use the frozen
// bench's own code-score formula (scenarios/lib/score.js): hidden 0.5, other scored checks 0.2, renormalised.
//   node rescore-table.js OUT FROZEN_BENCH   -> TSV: setup, task, arm, rep, saved, before, after, hiddenBefore, hiddenAfter
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [OUT, FROZEN] = process.argv.slice(2);
const { codeScore } = require(path.join(FROZEN, 'scenarios/lib/score.js'));

const r1 = (x) => (x === null || x === undefined ? '-' : (Math.round(10 * x) / 10).toFixed(1));
const hiddenOf = (checks) => { const t = (checks || []).filter((c) => c.type === 'tests' && c.tests); return t.length ? `${t.reduce((n, c) => n + c.tests.passed, 0)}/${t.reduce((n, c) => n + c.tests.total, 0)}` : '-'; };
const dirs = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

console.log(['setup', 'task', 'arm', 'rep', 'saved', 'before', 'after', 'hiddenSaved', 'hiddenBefore', 'hiddenAfter', 'status'].join('\t'));
for (const setup of dirs(path.join(OUT, 'runs', 'before'))) {
  for (const task of dirs(path.join(OUT, 'runs', 'before', setup))) {
    for (const arm of dirs(path.join(OUT, 'runs', 'before', setup, task))) {
      for (const rep of dirs(path.join(OUT, 'runs', 'before', setup, task, arm, task))) {
        const read = (phase) => JSON.parse(fs.readFileSync(path.join(OUT, 'runs', phase, setup, task, arm, task, rep, 'result.json'), 'utf8'));
        const b = read('before');
        const a = read('after');
        const saved = b.checksOriginal ?? b.checks;
        const sc = (checks) => codeScore(checks || []).score;
        console.log([setup, task, arm, rep, r1(sc(saved)), r1(sc(b.checks)), r1(sc(a.checks)), hiddenOf(saved), hiddenOf(b.checks), hiddenOf(a.checks), b.status].join('\t'));
      }
    }
  }
}
