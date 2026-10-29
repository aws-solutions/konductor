#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Proves each manifest task is usable, from the local cache only (no network):
//   a. the real fix (PR diff without test files) applied to the base tree passes every FAIL_TO_PASS and
//      PASS_TO_PASS test, with the PR's test files laid over it;
//   b. on the base tree with the same test files, every FAIL_TO_PASS test fails or is missing and every
//      PASS_TO_PASS test passes;
//   c. both runs are done twice with identical per-test results;
//   d. each run finishes in under 120 s;
//   e. every run happens in a new network namespace with no network, so a test that needs one fails.
// Also checks the pins (tree ids, content hash), the vendored test files against the merge commit, the
// license, the 2025+ preference and the size limits. A task that fails any check is reported as dropped.
//
//   node bench/real/validate-real.js [--ids a,b] [--cache DIR] [--out report.json] [--write]
//
// --write records the result in the manifest: "validation" on a good task, an entry in "dropped" (and
// removal from "tasks") for a failing one.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('./lib.js');
const probe = require('./probe.js');
const { leakScan, LEAK_RATIO } = require('./leakscan.js');
const { exportTree, materialize } = require('./materialize.js');
const { runRealTests, scoreReal } = require('../runner/lib/realtests.js');
const { buildCheckEnv } = require('../runner/lib/env.js');

const HIDDEN_DIR = path.join(lib.BENCH_DIR, 'tasks', 'hidden');
const MAX_RUN_SECONDS = 120;
const ALLOWED_LICENSES = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC']);
const MIN_FILES = 50;
const MAX_FILES = 400;
const MAX_FIX_FILES = 6;

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function snapshot(results, listed) {
  return listed.map((id) => `${id}=${results.get(id) ?? 'absent'}`).join('\n');
}

function validateEntry(entry, { cache, log = () => {} }) {
  const reasons = [];
  const warnings = [];
  const info = {};
  const fail = (m) => reasons.push(m);
  const { gitDir } = lib.entryPaths(lib.resolveCache(cache), entry.id);
  const work = tmp('real-val-');
  const home = tmp('real-home-');
  try {
    if (!fs.existsSync(gitDir)) return { id: entry.id, valid: false, reasons: ['not fetched into the cache'], warnings, info };

    if (!ALLOWED_LICENSES.has(entry.repo.license)) fail(`license ${entry.repo.license} is not permissive`);
    let passToPass = [];
    try { passToPass = lib.loadP2p(entry); } catch (e) { fail(e.message); }
    if (!entry.failToPass.length) fail('no FAIL_TO_PASS tests');
    if (!passToPass.length) fail('no PASS_TO_PASS tests');
    if (!(entry.test.probeModules || []).length) fail('test.probeModules is empty, so the location of the code under test is not proven');
    if (entry.fixFiles.length < 1 || entry.fixFiles.length > MAX_FIX_FILES) fail(`${entry.fixFiles.length} non-test files in the fix, need 1 to ${MAX_FIX_FILES}`);
    if (entry.sourceFiles.all < MIN_FILES || entry.sourceFiles.all > MAX_FILES) fail(`${entry.sourceFiles.all} source files at base, need ${MIN_FILES} to ${MAX_FILES}`);
    if (!/^20(2[5-9]|[3-9]\d)-/.test(entry.pr.mergedAt)) warnings.push(`merged ${entry.pr.mergedAt.slice(0, 10)}, before 2025`);
    info.mergedAt = entry.pr.mergedAt.slice(0, 10);

    // Pins: trees and content hash.
    const base = path.join(work, 'base');
    let m;
    try { m = materialize(entry, base, { cache }); } catch (e) { fail(`materialize: ${e.message}`); return { id: entry.id, valid: false, reasons, warnings, info }; }
    if (entry.fileCount !== m.fileCount) fail(`file count ${m.fileCount}, manifest ${entry.fileCount}`);
    if (lib.git(gitDir, ['rev-parse', `${entry.mergeSha}^{tree}`]).trim() !== entry.mergeTreeSha) fail('merge tree differs from the pin');

    // The vendored test files are the merge commit's files, byte for byte, and cover every test file of the PR.
    const overlay = path.join(HIDDEN_DIR, entry.id, 'overlay');
    for (const f of entry.testFiles) {
      const want = lib.git(gitDir, ['show', `${entry.mergeSha}:${f}`], { binary: true });
      const file = path.join(overlay, f);
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(want)) fail(`vendored test file differs from the merge commit: ${f}`);
    }
    const vendored = fs.existsSync(overlay) ? lib.listFiles(overlay) : [];
    if (vendored.join('\n') !== [...entry.testFiles].sort().join('\n')) fail('vendored files do not match testFiles');
    const diffNames = lib.git(gitDir, ['diff', '--name-status', '-z', entry.baseSha, entry.mergeSha]).split('\0').filter(Boolean);
    const deleted = diffNames.some((n, i) => /^D/.test(n) && lib.isTestPath(diffNames[i + 1] || ''));
    if (deleted) fail('the PR deletes a test file');
    for (const f of ['LICENSE', 'NOTICE']) if (!fs.existsSync(path.join(HIDDEN_DIR, entry.id, f))) fail(`missing ${f} next to the vendored tests`);

    // Fix patch applied to a copy of the base tree.
    const { patch, files } = lib.fixPatch(gitDir, entry);
    info.fixPatchFiles = files;
    const homes = [os.homedir(), fs.realpathSync(os.homedir())];
    const tilde = (p) => { const h = homes.find((x) => p.startsWith(`${x}/`)); return h ? `~${p.slice(h.length)}` : p; };
    info.hostCopies = leakScan(entry, patch, { baseDir: base }).map((c) => ({ copy: tilde(c.copy), masked: c.masked, ratio: +c.ratio.toFixed(2) }));
    const unmaskable = info.hostCopies.filter((c) => !c.masked && c.ratio >= LEAK_RATIO);
    if (unmaskable.length) {
      const best = unmaskable.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      fail(`the fix is readable in ${unmaskable.length} copy(ies) vendored inside another package, for example ${best.copy} (${Math.round(best.ratio * 100)} percent of its added lines); they cannot be masked without breaking that package`);
    }
    const fixed = path.join(work, 'fixed');
    fs.cpSync(base, fixed, { recursive: true });
    const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: fixed, input: patch, encoding: 'utf8' });
    if (applied.status !== 0) { fail(`fix patch does not apply: ${(applied.stderr || '').trim().slice(0, 200)}`); return { id: entry.id, valid: false, reasons, warnings, info }; }

    const { env } = buildCheckEnv(process.env, { home, tmpdir: path.join(home, 'tmp'), konductor: false });
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    const scratchDir = path.join(work, 'scratch');
    fs.mkdirSync(scratchDir, { recursive: true });
    const scratchReal = fs.realpathSync(scratchDir);
    const probeProblems = new Set();
    const probed = [];
    // Every run loads the project through a start-up hook; where it came from is checked after the run.
    const run = (root) => {
      const p = probe.prepare(fs.mkdtempSync(path.join(work, 'probe-')), { runner: entry.test.runner, modules: entry.test.probeModules, existing: entry.test.env });
      const r = runRealTests(root, { ...entry.test, env: { ...entry.test.env, ...p.env } }, { overlayDir: overlay, env, wrapCmd: lib.netlessWrap, scratchDir });
      const ev = probe.evaluate(p.out, { runner: entry.test.runner, modules: entry.test.probeModules, root: scratchReal });
      ev.problems.forEach((x) => probeProblems.add(x));
      if (!probed.length) probed.push(...ev.seen);
      return r;
    };
    const listed = [...entry.failToPass, ...passToPass];
    const runs = { fix: [], base: [] };
    for (const [label, root] of [['fix', fixed], ['base', base]]) {
      for (let i = 0; i < 2; i++) {
        log(`${entry.id}: ${label} run ${i + 1}`);
        runs[label].push(run(root));
      }
    }
    info.seconds = { fix: runs.fix.map((r) => +r.seconds.toFixed(1)), base: runs.base.map((r) => +r.seconds.toFixed(1)) };
    for (const [label, rs] of Object.entries(runs)) {
      rs.forEach((r, i) => {
        if (r.timedOut) fail(`${label} run ${i + 1} timed out`);
        if (r.seconds >= MAX_RUN_SECONDS) fail(`${label} run ${i + 1} took ${r.seconds.toFixed(0)} s, limit ${MAX_RUN_SECONDS}`);
        if (r.results.size === 0) fail(`${label} run ${i + 1} produced no parsable test results: ${r.tail.slice(-200)}`);
      });
      if (snapshot(rs[0].results, listed) !== snapshot(rs[1].results, listed)) fail(`${label} runs differ between repetitions (not deterministic)`);
    }
    for (const x of probeProblems) fail(`source location: ${x}`);
    info.loadedFrom = probed;
    const sFix = scoreReal({ results: runs.fix[0].results, failToPass: entry.failToPass, passToPass });
    if (sFix.failToPass.passed !== sFix.failToPass.total) fail(`with the real fix FAIL_TO_PASS passes ${sFix.failToPass.passed}/${sFix.failToPass.total}`);
    if (sFix.passToPass.passed !== sFix.passToPass.total) fail(`with the real fix PASS_TO_PASS passes ${sFix.passToPass.passed}/${sFix.passToPass.total}`);
    const sBase = scoreReal({ results: runs.base[0].results, failToPass: entry.failToPass, passToPass });
    if (sBase.failToPass.passed !== 0) fail(`at base FAIL_TO_PASS passes ${sBase.failToPass.passed}/${sBase.failToPass.total}, expected 0`);
    if (sBase.passToPass.passed !== sBase.passToPass.total) fail(`at base PASS_TO_PASS passes ${sBase.passToPass.passed}/${sBase.passToPass.total}`);
    info.counts = { failToPass: entry.failToPass.length, passToPass: passToPass.length, testsRun: runs.fix[0].results.size };
    info.network = lib.netlessAvailable() ? 'none (unshare --net, loopback only)' : 'not verified';
    if (info.network === 'not verified') warnings.push('unshare --net is unavailable here, network independence not verified');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
  return { id: entry.id, valid: reasons.length === 0, reasons, warnings, info };
}

function main(argv) {
  const args = { write: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') args.write = true;
    else if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  }
  const manifest = lib.loadManifest();
  const wanted = args.ids ? args.ids.split(',') : manifest.tasks.map((t) => t.id);
  const results = [];
  for (const id of wanted) {
    const r = validateEntry(lib.findEntry(manifest, id), { cache: args.cache, log: (m) => console.error(m) });
    results.push(r);
    const s = r.info.seconds ? ` fix ${r.info.seconds.fix.join('/')} s, base ${r.info.seconds.base.join('/')} s` : '';
    console.log(`${r.valid ? 'VALID  ' : 'DROPPED'} ${id}${s}${r.info.counts ? ` F2P ${r.info.counts.failToPass} P2P ${r.info.counts.passToPass}` : ''}`);
    if (r.info.hostCopies) {
      const hc = r.info.hostCopies;
      const top = (xs) => (xs.length ? Math.max(...xs.map((c) => c.ratio)) : 0);
      console.log(`    host copies of the project: ${hc.filter((c) => c.masked).length} maskable (${hc.filter((c) => c.masked && c.ratio >= 0.6).length} hold the fix, to be masked), ${hc.filter((c) => !c.masked).length} vendored inside other packages (highest share of the fix: ${top(hc.filter((c) => !c.masked))})`);
    }
    if (r.info.loadedFrom) console.log(`    code loaded from: ${r.info.loadedFrom.slice(0, 3).join(', ')}`);
    r.reasons.forEach((x) => console.log(`    reason: ${x}`));
    r.warnings.forEach((x) => console.log(`    warning: ${x}`));
  }
  if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(results, null, 2)}\n`);
  if (args.write) {
    const when = new Date().toISOString();
    for (const r of results) {
      const entry = lib.findEntry(manifest, r.id);
      if (r.valid) {
        entry.validation = {
          validatedAt: when, runsPerState: 2, seconds: r.info.seconds, network: r.info.network, counts: r.info.counts,
          loadedFrom: r.info.loadedFrom, hostCopies: r.info.hostCopies,
        };
      } else {
        manifest.dropped = (manifest.dropped || []).filter((d) => d.id !== r.id);
        manifest.dropped.push({ id: r.id, repo: entry.repo.name, pr: entry.pr.number, reasons: r.reasons });
        manifest.tasks = manifest.tasks.filter((t) => t.id !== r.id);
        fs.rmSync(path.join(HIDDEN_DIR, r.id), { recursive: true, force: true });
        fs.rmSync(path.join(lib.P2P_DIR, `${r.id}.txt.gz`), { force: true });
      }
    }
    fs.writeFileSync(lib.MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (results.some((r) => !r.valid)) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { validateEntry };
