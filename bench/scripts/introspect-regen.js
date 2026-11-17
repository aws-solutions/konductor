#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rebuilds the --introspect reports of a finished out dir into a separate directory, offline. For every run below
// <src> it reads stream.jsonl, result.json, session/ and the introspect/ captures, and writes timeline.md and
// timeline.json to <dest>/<run>/introspect/, then <dest>/introspect-summary.md and .json. Nothing under <src> is
// written, and no model is called.
//
//   node bench/scripts/introspect-regen.js <src-out-dir> <dest-dir>

const fs = require('node:fs');
const path = require('node:path');
const { buildReport, renderReport } = require('../runner/lib/introspect/report.js');
const { findRuns, rowFromReport, render } = require('./introspect-summary.js');

const inside = (p, dir) => p === dir || p.startsWith(dir + path.sep);

function regen(src, dest) {
  const s = fs.realpathSync(path.resolve(src));
  const d = path.resolve(dest);
  if (inside(d, s) || inside(s, d)) throw new Error('introspect-regen: <dest> must not be inside <src> or contain it');
  if (fs.existsSync(d) && fs.readdirSync(d).length) throw new Error(`introspect-regen: ${d} is not empty; pick a new directory`);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const rows = [];
  for (const runDir of findRuns(s)) {
    const rel = path.relative(s, runDir);
    const out = path.join(d, rel, 'introspect');
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const r = buildReport(runDir);
    const { trace, ...rest } = r;
    fs.writeFileSync(path.join(out, 'timeline.md'), renderReport(r), { mode: 0o600 });
    fs.writeFileSync(path.join(out, 'timeline.json'), `${JSON.stringify({ ...rest, timelineEntries: trace?.entries?.length ?? 0 }, null, 2)}\n`, { mode: 0o600 });
    rows.push(rowFromReport(rest, { run: rel, timeline: path.join(rel, 'introspect', 'timeline.md') }));
  }
  fs.writeFileSync(path.join(d, 'introspect-summary.md'), render(rows), { mode: 0o600 });
  fs.writeFileSync(path.join(d, 'introspect-summary.json'), `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  return { runs: rows.length, dest: d };
}

function main(argv) {
  const [src, dest] = argv.slice(2);
  if (!src || !dest) { console.error('usage: introspect-regen.js <src-out-dir> <dest-dir>'); process.exit(2); }
  const { runs, dest: d } = regen(src, dest);
  console.log(`${runs} run(s) -> ${path.join(d, 'introspect-summary.md')}`);
}

if (require.main === module) main(process.argv);

module.exports = { regen };
