// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios lint|coverage|prereg ...`: authoring tools for the scenario pack. Everything here is free: no model call, no credits.

const fs = require('node:fs');
const path = require('node:path');
const { resolveBase } = require('../cap/source.js');
const { scanRepo, loadAgentSpecs } = require('../cap/scan.js');
const { repoRootOf, textFlag } = require('../runner/lib/flag-values.js');
const { lintDir, catalogOfScan } = require('./lint.js');
const { loadTaskFiles } = require('./files.js');
const { buildCoverage, renderCoverageMd } = require('./coverage.js');

const SUBCOMMANDS = ['lint', 'coverage'];

/** Runs `fn(scan, base)` on the konductor tree --base names, and removes the temporary export afterwards. */
function withTree(opts, fn) {
  const spec = textFlag(opts.base);
  if (!spec) throw new Error('--base REF is required: the unit names come from that konductor tree (a git ref or dir:PATH)');
  const b = resolveBase(spec, repoRootOf(opts));
  try { return fn(scanRepo(b.dir), b, loadAgentSpecs(b.dir)); } finally { b.cleanup(); }
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

// The owner-approved list of units with no fair scenario: { "skill:name": "reason" }. --selection-only FILE, else DIR/selection-only.json when present.
function readSelectionOnly(opts, dir) {
  const given = textFlag(opts['selection-only']);
  const file = given ? path.resolve(given) : path.join(path.resolve(dir), 'selection-only.json');
  if (!given && !fs.existsSync(file)) return {};
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read ${file}: ${e.code || e.message}`); }
  for (const [id, reason] of Object.entries(j)) {
    if (!/^(skill|sop|agent):/.test(id) || typeof reason !== 'string' || !reason.trim()) throw new Error(`${file}: "${id}" needs a unit id (kind:name) and a non-empty reason`);
  }
  return j;
}

function cmdCoverage(opts) {
  const dir = dirArg(opts, 'coverage');
  const tasks = loadTaskFiles(dir).map((t) => t.task);
  const selectionOnly = readSelectionOnly(opts, dir);
  const cov = withTree(opts, (scan, b, specs) => buildCoverage({ tasks, scan, specs, selectionOnly, base: { label: b.label, commitSha: b.commitSha } }));
  const out = path.resolve(textFlag(opts.out) ?? dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'coverage.json'), `${JSON.stringify(cov, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'coverage.md'), renderCoverageMd(cov));
  const s = cov.summary;
  console.log(`wrote ${path.join(out, 'coverage.json')} and coverage.md: ${s.units} units, ${s.covered} covered, ${s.selectionOnly} selection-only, ${s.holes} hole(s); ${cov.shortfalls.length} phase or role minimum(s) missed`);
  if (opts['fail-on-hole'] && (cov.holes.length || cov.shortfalls.length)) {
    for (const id of cov.holes) console.error(`hole: ${id}: ${cov.units.find((u) => u.id === id).missing.join('; ')}`);
    for (const x of cov.shortfalls) console.error(`short: ${x}`);
    process.exitCode = 1;
  }
}

function cmdScenarios(opts) {
  const sub = opts._[0];
  if (!SUBCOMMANDS.includes(sub)) { console.error(`bench: scenarios takes ${SUBCOMMANDS.join(', ')}`); process.exitCode = 2; return; }
  try {
    if (sub === 'lint') cmdLint(opts);
    else if (sub === 'coverage') cmdCoverage(opts);
  } catch (e) {
    console.error(`scenarios ${sub}: ${e.message}`);
    process.exitCode = 2;
  }
}

module.exports = { cmdScenarios, SUBCOMMANDS, withTree, dirArg };
