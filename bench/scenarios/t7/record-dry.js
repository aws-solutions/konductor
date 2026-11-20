#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runs the free dry run of one T7 task (../t1/dry-run.js with --dir) twice and records it in the task file:
// task.pilot.dryRun (schema: reference, stub, lazy, alt, date) and, under task.pilot.scores.dryRunRepeat, whether
// the two runs gave the same scores. Decision `keep` needs every gate: reference 95 or more, stub 20 or less,
// lazy 40 or less, alternative 80 or more, a deterministic run, and the same scores twice.
//
//   node record-dry.js <task-id> [--repeat 3]

const fs = require('node:fs');
const path = require('node:path');
const { dryRun } = require('../t1/dry-run.js');

const DIR = __dirname;
const round = (n) => Math.round(n * 10) / 10;

/** The pilot block for two dry-run results of the same task (pure). */
function pilotOf(res, again, date) {
  const scores = (r) => ({ reference: round(r.reference.score), stub: round(r.stub.score), lazy: r.lazy ? round(r.lazy.score) : null, alt: r.alt ? round(r.alt.score) : null });
  const first = scores(res);
  const same = JSON.stringify(first) === JSON.stringify(scores(again));
  const pass = res.pass && res.answersPass !== false && res.answersPresent === true && same;
  return {
    scores: { dryRunRepeat: { repeats: res.repeat, deterministic: res.deterministic, sameTwice: same } },
    reference: first.reference,
    stub: first.stub,
    dryRun: { ...first, lazy: first.lazy ?? 0, alt: first.alt ?? 0, date },
    decision: pass ? 'keep' : 'fix',
    date,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--repeat');
  const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 3;
  const file = path.join(DIR, `${id}.json`);
  const res = dryRun(id, { repeat, dir: DIR });
  const again = dryRun(id, { repeat: 1, dir: DIR });
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  task.pilot = pilotOf(res, again, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  console.log(JSON.stringify({ id, ...task.pilot.dryRun, ...task.pilot.scores.dryRunRepeat, decision: task.pilot.decision }));
  if (task.pilot.decision !== 'keep') process.exitCode = 1;
}

module.exports = { pilotOf };
