#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of T8 tasks (no model call), on T5's scorer with T8's directory: the reference scores at least 95,
// the untouched fixture 20 or less, three repeats agree, every `tests` check carries a per-test timeout, and the task
// file is valid against bench/schema/task.schema.json. A task with `variants/<id>/lazy/` and `variants/<id>/alt/` overlays
// (a plausible shallow answer and a correct answer shaped unlike the reference) must also score the lazy one at 40 or
// less and the alternative at 80 or more.
//   TMPDIR=/tmp nice -n 19 node dry-run.js [id ...]   (default: every t8-*.json)   prints one line per task, exit 1 on a fail
const fs = require('node:fs');
const path = require('node:path');
const { dryRun } = require('../t5/dry-run.js');
const { validate, loadSchema } = require('../../runner/lib/schema.js');

const DIR = __dirname;

function one(id) {
  const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  const timeouts = task.checks.filter((c) => c.type === 'tests').every((c) => /--test-timeout=\d+/.test(c.cmd));
  const schemaErrors = validate(loadSchema('task'), task);
  const vdir = path.join(DIR, 'variants', id);
  const variants = Object.fromEntries(['lazy', 'alt'].filter((n) => fs.existsSync(path.join(vdir, n))).map((n) => [n, path.join(vdir, n)]));
  const r = dryRun(id, { dir: DIR, variants });
  const v = Object.fromEntries(Object.entries(r.variants).map(([n, m]) => [n, Number(m.score.toFixed(1))]));
  const variantsOk = (v.lazy === undefined || v.lazy <= 40) && (v.alt === undefined || v.alt >= 80);
  return { id, pass: r.pass && timeouts && !schemaErrors.length && variantsOk, schemaErrors: schemaErrors.slice(0, 5), ...(Object.keys(v).length ? { variants: v } : {}), reference: Number(r.reference.score.toFixed(1)), stub: Number(r.stub.score.toFixed(1)), deterministic: r.deterministic, timeouts, hidden: [r.reference.hidden, r.stub.hidden] };
}

if (require.main === module) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter((n) => /^t8-.*\.json$/.test(n)).map((n) => n.slice(0, -5));
  let ok = true;
  for (const id of ids) {
    const r = one(id);
    ok = ok && r.pass;
    console.log(JSON.stringify(r));
  }
  if (!ok) process.exitCode = 1;
}

module.exports = { one };
