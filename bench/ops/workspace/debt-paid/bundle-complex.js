#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Builds one recheck work dir for a complex task (bench/complex/<id>.json), the way standard-recheck/bundle.js does
// for a scenario task. Free: reads the pinned bench, never calls a model.
//   BENCH_REPO=<pinned checkout> node bundle-complex.js <outdir> <id> [id ...]
// Per task: tasks/<id>/{task.json (no review, pilot, handEdited or authorship), fixture/ (the agent's start folder,
// without the grader's answer key: docs/REQUIREMENTS.md, docs/INTERFACE.md, cobol/, data/), hidden/ (the hidden tests,
// their lib and the golden outputs)}. The reference port is left out: the recheck compares the tests with the rules.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO = process.env.BENCH_REPO;
if (!REPO) throw new Error('set BENCH_REPO to the pinned checkout');
const COMPLEX = path.join(REPO, 'bench/complex');
const { ANSWER_KEY } = require(path.join(REPO, 'bench/runner/lib/check-matcher.js'));

const [out, ...ids] = process.argv.slice(2);
if (!out || !ids.length) throw new Error('usage: bundle-complex.js OUTDIR ID...');
for (const id of ids) {
  const task = JSON.parse(fs.readFileSync(path.join(COMPLEX, `${id}.json`), 'utf8'));
  const dst = path.join(out, 'tasks', id);
  fs.mkdirSync(dst, { recursive: true });
  const { review, pilot, handEdited, authorship, ...shown } = task;
  fs.writeFileSync(path.join(dst, 'task.json'), `${JSON.stringify(shown, null, 2)}\n`);
  // The hidden folder holds `hidden/` itself, which the bench copies over the workspace root: keep that layout.
  fs.cpSync(path.join(COMPLEX, 'fixtures', task.fixture), path.join(dst, 'fixture'), { recursive: true, filter: (p) => path.basename(p) !== ANSWER_KEY });
  fs.cpSync(path.join(COMPLEX, 'hidden', task.hidden, 'hidden'), path.join(dst, 'hidden'), { recursive: true });
}
console.log(`${ids.length} tasks in ${out}`);
