// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios lint|coverage|prereg ...`: authoring tools for the scenario pack. Everything here is free: no model call, no credits.

const { resolveBase } = require('../cap/source.js');
const { scanRepo } = require('../cap/scan.js');
const { repoRootOf, textFlag } = require('../runner/lib/flag-values.js');
const { lintDir, catalogOfScan } = require('./lint.js');

const SUBCOMMANDS = ['lint'];

/** Runs `fn(scan, base)` on the konductor tree --base names, and removes the temporary export afterwards. */
function withTree(opts, fn) {
  const spec = textFlag(opts.base);
  if (!spec) throw new Error('--base REF is required: the unit names come from that konductor tree (a git ref or dir:PATH)');
  const b = resolveBase(spec, repoRootOf(opts));
  try { return fn(scanRepo(b.dir), b); } finally { b.cleanup(); }
}

function dirArg(opts, sub) {
  const dir = opts._[1];
  if (!dir) throw new Error(`scenarios ${sub} needs the task directory: bench.js scenarios ${sub} DIR`);
  return dir;
}

function cmdLint(opts) {
  const dir = dirArg(opts, 'lint');
  const res = withTree(opts, (scan, b) => ({ ...lintDir(dir, catalogOfScan(scan)), base: b.label }));
  if (opts.json) console.log(JSON.stringify(res, null, 2));
  else {
    for (const f of res.findings) console.log(`${f.taskId}: ${f.rule}: ${f.detail} (${f.file})`);
    console.log(`${res.tasks} task(s) checked against ${res.base}: ${res.findings.length ? `${res.findings.length} finding(s)` : 'clean'}`);
  }
  if (res.findings.length) process.exitCode = 1;
}

function cmdScenarios(opts) {
  const sub = opts._[0];
  if (!SUBCOMMANDS.includes(sub)) { console.error(`bench: scenarios takes ${SUBCOMMANDS.join(', ')}`); process.exitCode = 2; return; }
  try {
    if (sub === 'lint') cmdLint(opts);
  } catch (e) {
    console.error(`scenarios ${sub}: ${e.message}`);
    process.exitCode = 2;
  }
}

module.exports = { cmdScenarios, SUBCOMMANDS, withTree, dirArg };
