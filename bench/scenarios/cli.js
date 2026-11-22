// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios lint|coverage|prereg|pilot-table|ready|spot-review ...`: authoring tools for the scenario pack. Everything here is free: no model call, no credits.

const fs = require('node:fs');
const path = require('node:path');
const { resolveBase } = require('../cap/source.js');
const { scanRepo, loadAgentSpecs } = require('../cap/scan.js');
const { repoRootOf, textFlag } = require('../runner/lib/flag-values.js');
const { lintDir, catalogOfScan, readBaseline } = require('./lint.js');
const { loadTaskFiles } = require('./files.js');
const packSuiteLib = require('./pack-suite.js');
const { buildCoverage, renderCoverageMd } = require('./coverage.js');
const prereg = require('./prereg.js');
const { cmdPilotTable } = require('./pilot-table.js');
const { cmdReady } = require('./ready.js');
const { cmdSpotReview } = require('./spot-review.js');

const SUBCOMMANDS = ['lint', 'coverage', 'prereg', 'pilot-table', 'ready', 'spot-review'];

/** Runs `fn(scan, base)` on the konductor tree --base names, and removes the temporary export afterwards. */
function withTree(opts, fn) {
  const spec = textFlag(opts.base);
  if (!spec) throw new Error('--base REF is required: the unit names come from that konductor tree (a git ref or dir:PATH)');
  const b = resolveBase(spec, repoRootOf(opts));
  try { return fn(scanRepo(b.dir), b, loadAgentSpecs(b.dir)); } finally { b.cleanup(); }
}

function dirArg(opts, sub, at = 1) {
  const dir = opts._[at];
  if (!dir) throw new Error(`scenarios ${sub} needs the task directory: bench.js scenarios ${sub} DIR`);
  return dir;
}

/**
 * When `dir` is the scenario pack itself: the message that bench/suites/pack.json no longer lists the pack's tasks, or
 * null. A task added without regenerating the suite file then fails the lint, not only the full suite (D-164).
 */
function packSuiteProblem(dir) {
  if (path.resolve(dir) !== __dirname) return null;
  const want = packSuiteLib.render(packSuiteLib.packSuite());
  const have = fs.existsSync(packSuiteLib.SUITE_FILE) ? fs.readFileSync(packSuiteLib.SUITE_FILE, 'utf8') : null;
  return have === want ? null : 'bench/suites/pack.json does not list the pack\'s tasks: run node bench/scenarios/pack-suite.js and commit bench/suites/pack.json';
}

function cmdLint(opts) {
  const dir = dirArg(opts, 'lint');
  const baseline = readBaseline();
  const res = withTree(opts, (scan, b) => ({ ...lintDir(dir, catalogOfScan(scan), { baseline }), base: b.label }));
  res.packSuite = packSuiteProblem(dir);
  const fresh = res.findings.filter((f) => !f.known);
  if (opts.json) console.log(JSON.stringify(res, null, 2));
  else {
    for (const f of res.findings) console.log(`${f.known ? 'known ' : ''}${f.taskId}: ${f.rule}: ${f.detail} (${f.file})${f.known ? ` [${f.known}]` : ''}`);
    if (res.packSuite) console.log(res.packSuite);
    for (const k of res.stale) console.log(`stale baseline entry (fixed? remove it from bench/scenarios/lint-baseline.json): ${k}`);
    const known = res.findings.length - fresh.length;
    console.log(`${res.tasks} task(s) checked against ${res.base}: ${fresh.length ? `${fresh.length} finding(s)` : 'clean'}${known ? `, ${known} known (lint-baseline.json)` : ''}${res.stale.length ? `, ${res.stale.length} stale baseline entr${res.stale.length === 1 ? 'y' : 'ies'}` : ''}`);
  }
  if (fresh.length || res.stale.length || res.packSuite) process.exitCode = 1;
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

const today = () => new Date().toISOString().slice(0, 10);

function cmdPrereg(opts) {
  const action = opts._[1];
  if (action !== 'freeze' && action !== 'check') throw new Error('scenarios prereg takes freeze or check: bench.js scenarios prereg freeze|check DIR');
  const dir = dirArg(opts, `prereg ${action}`, 2);
  if (action === 'freeze') {
    // The lint and the coverage gate run on the konductor tree --base names, before anything is written (DEBT D-55).
    const tasks = loadTaskFiles(dir).map((t) => t.task);
    const { problems, gates } = withTree(opts, (scan, b, specs) => prereg.freezeGates({
      lint: lintDir(dir, catalogOfScan(scan), { baseline: readBaseline() }),
      coverage: buildCoverage({ tasks, scan, specs, selectionOnly: readSelectionOnly(opts, dir), base: { label: b.label, commitSha: b.commitSha } }),
      base: { label: b.label, commitSha: b.commitSha ?? null },
      acceptGaps: textFlag(opts['accept-gaps']),
    }));
    if (problems.length) { console.error(`scenarios prereg: the pack cannot be frozen:\n${problems.join('\n')}`); process.exitCode = 1; return; }
    const rec = prereg.freezePrereg(dir, { date: textFlag(opts.date) ?? today(), gates });
    console.log(`wrote ${path.join(path.resolve(dir), prereg.FILE)}: ${rec.tasks.length} task(s) (${rec.split.dev.length} DEV, ${rec.split.heldOut.length} HELD-OUT), lock hash ${rec.lockHash}`);
    return;
  }
  const file = path.join(path.resolve(dir), prereg.FILE);
  const problems = prereg.checkPrereg(file, dir);
  if (problems.length) { for (const x of problems) console.error(`prereg: ${x}`); process.exitCode = 1; return; }
  console.log(`${file} matches the task files and the rules`);
}

function cmdScenarios(opts) {
  const sub = opts._[0];
  if (!SUBCOMMANDS.includes(sub)) { console.error(`bench: scenarios takes ${SUBCOMMANDS.join(', ')}`); process.exitCode = 2; return; }
  try {
    if (sub === 'lint') cmdLint(opts);
    else if (sub === 'coverage') cmdCoverage(opts);
    else if (sub === 'prereg') cmdPrereg(opts);
    else if (sub === 'pilot-table') cmdPilotTable(opts);
    else if (sub === 'ready') cmdReady(opts);
    else if (sub === 'spot-review') cmdSpotReview(opts);
  } catch (e) {
    console.error(`scenarios ${sub}: ${e.message}`);
    process.exitCode = 2;
  }
}

module.exports = { cmdScenarios, SUBCOMMANDS, withTree, dirArg };
