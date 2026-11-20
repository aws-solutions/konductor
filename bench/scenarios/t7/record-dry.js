#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runs the free dry run of one T7 task (../t1/dry-run.js with --dir) and records its scores in the task file:
// task.pilot.scores.dryRun holds the reference, stub, lazy and alternative scores. The schema has no pilot.dryRun
// field, so the scores sit under pilot.scores; a paid pilot later adds its own scores beside them.
//
//   node record-dry.js <task-id> [--repeat 3]

const fs = require('node:fs');
const path = require('node:path');
const { dryRun } = require('../t1/dry-run.js');

const DIR = __dirname;
const round = (n) => Math.round(n * 10) / 10;

/** The pilot block for a dry-run result (pure). */
function pilotOf(res, date) {
  const dry = { repeats: res.repeat, deterministic: res.deterministic, reference: round(res.reference.score), stub: round(res.stub.score) };
  for (const k of ['lazy', 'alt']) if (res[k]) dry[k] = round(res[k].score);
  const pass = res.pass && res.answersPass !== false;
  return { scores: { dryRun: dry }, reference: dry.reference, stub: dry.stub, decision: pass ? 'keep' : 'fix', date };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--repeat');
  const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 3;
  const file = path.join(DIR, `${id}.json`);
  const res = dryRun(id, { repeat, dir: DIR });
  const task = JSON.parse(fs.readFileSync(file, 'utf8'));
  task.pilot = pilotOf(res, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(file, `${JSON.stringify(task, null, 2)}\n`);
  console.log(JSON.stringify({ id, ...task.pilot.scores.dryRun, decision: task.pilot.decision }));
  if (task.pilot.decision !== 'keep') process.exitCode = 1;
}

module.exports = { pilotOf };
