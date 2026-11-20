#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free dry run of one T1 task (no model call): scores the reference solution and a stub with the bench's own check
// code, repeats the run to prove the checks are deterministic, and proves that a hung hidden test fails alone.
//
//   node dry-run.js <task-id> [--repeat 3] [--json] [--dir BATCH_DIR]   (default: this directory; T7 uses it with --dir)
//
// Layout under bench/scenarios/t1/: <id>.json, fixtures/<id>/, hidden/<id>/ (copied over the workspace root, so a
// task's tests sit in hidden/<id>/hidden/), solutions/<id>/ (overlay on the fixture; solutions/<id>/DELETE.txt lists
// paths to remove). The stub is the untouched fixture: an agent that changed nothing.
// Score of a code-only run: the hidden-test share (weight 0.5) and the weighted share of substance checks (0.2),
// renormalised, as the bench's scoring does when no judge scores the rubric.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evalCheck } = require('../../runner/lib/check-matcher.js');
const { resolvePython, linkPython, wantedVersion } = require('../../runner/lib/python-pin.js');

const DIR = __dirname;
const WEIGHTS = { hidden: 0.5, checks: 0.2 };
const CANARY_NODE = "const { test } = require('node:test');\ntest('canary: a hung test', () => new Promise(() => {}));\n";
const CANARY_PY = "import time\nfrom timeouts import TimedCase\n\n\nclass Canary(TimedCase):\n    def test_canary_hang(self):\n        time.sleep(600)\n";

const weightOf = (c) => (Number.isFinite(c.weight) && c.weight >= 0 ? c.weight : 1);

/** The code-only quality score 0..100 of one run from its check results. */
function scoreOf(results) {
  const tests = results.filter((r) => r.type === 'tests' && r.tests);
  const hidden = tests.length ? tests.reduce((n, r) => n + r.tests.passed, 0) / tests.reduce((n, r) => n + r.tests.total, 0) : null;
  const scored = results.filter((r) => r.kind !== 'format' && r.type !== 'tests');
  const total = scored.reduce((n, r) => n + weightOf(r), 0);
  const checks = total > 0 ? scored.reduce((n, r) => n + (r.passed ? weightOf(r) : 0), 0) / total : null;
  const parts = { hidden, checks };
  const used = Object.keys(WEIGHTS).filter((k) => parts[k] !== null);
  const sum = used.reduce((n, k) => n + WEIGHTS[k], 0);
  return { score: used.length ? (used.reduce((n, k) => n + WEIGHTS[k] * parts[k], 0) / sum) * 100 : null, hidden, checks };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

// `dir` is the batch directory; a task may name another task's fixture (a near-miss twin shares its real task's).
const fixtureOf = (dir, task) => path.join(dir, 'fixtures', task.fixture || task.id);

// A workspace named `name`: the fixture, plus an overlay dir when one is given (DELETE.txt in it lists paths to remove).
function workspace(root, task, name, overlay, dir) {
  const ws = path.join(root, name);
  copyTree(fixtureOf(dir, task), ws);
  if (overlay) {
    const del = path.join(overlay, 'DELETE.txt');
    if (fs.existsSync(del)) {
      for (const p of fs.readFileSync(del, 'utf8').split('\n').filter(Boolean)) fs.rmSync(path.join(ws, p), { recursive: true, force: true });
    }
    fs.cpSync(overlay, ws, { recursive: true, filter: (p) => path.basename(p) !== 'DELETE.txt' });
  }
  return ws;
}

// The free shallow answer: the reference's docs, changelog, config and test files, with none of its code changes. It shows
// how much of the score a run gets from keyword and file checks without doing the work. A path is code when it has a
// code extension and is not a test file.
const isCode = (rel) => /\.(c?m?js|ts|py)$/.test(rel) && !/(^|\/)(tests?|__tests__)\/|(^|\/)test_[^/]*\.py$|\.test\.(c?m?js|ts)$/.test(rel);

function shallowOverlay(root, solutionDir) {
  const out = path.join(root, 'overlay-shallow');
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(solutionDir, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.name !== 'DELETE.txt' && !isCode(r)) {
        fs.mkdirSync(path.dirname(path.join(out, r)), { recursive: true });
        fs.copyFileSync(path.join(solutionDir, r), path.join(out, r));
      }
    }
  };
  fs.mkdirSync(out, { recursive: true });
  walk('');
  return out;
}

function runChecks(task, ws, hiddenDir, dir, env, scratchDir) {
  return task.checks.map((c) => {
    let r;
    try {
      r = evalCheck(ws, c, { pristineDir: fixtureOf(dir, task), hiddenDir, env, scratchDir });
    } catch (e) {
      r = { passed: false, detail: e.message };
    }
    return { type: c.type, weight: c.weight, kind: c.kind, passed: r.passed, detail: r.detail, ...(r.tests ? { tests: r.tests } : {}) };
  });
}

const signature = (results) => JSON.stringify(results.map((r) => [r.type, r.passed, r.tests ? [r.tests.passed, r.tests.total] : null]));

// Adds a test that never finishes to a copy of the hidden dir; the suite must still finish, with that one test failed.
function canary(task, hiddenDir, ws, env, scratchDir, baseline) {
  const hid = path.join(scratchDir, 'hidden-canary');
  copyTree(hiddenDir, hid);
  const py = fs.existsSync(path.join(hid, 'hidden', 'py'));
  if (py) fs.writeFileSync(path.join(hid, 'hidden', 'py', 'test_zz_canary.py'), CANARY_PY);
  else fs.writeFileSync(path.join(hid, 'hidden', 'zz-canary.test.js'), CANARY_NODE);
  const check = task.checks.find((c) => c.type === 'tests');
  const t0 = Date.now();
  const r = evalCheck(ws, check, { hiddenDir: hid, env, scratchDir });
  const sec = (Date.now() - t0) / 1000;
  const ok = r.tests && r.tests.passed === baseline.passed && r.tests.total === baseline.total + 1;
  return { ok, seconds: sec, detail: r.detail };
}

function dryRun(id, { repeat = 3, dir = DIR } = {}) {
  const task = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `t1-dry-${id}-`));
  try {
    const env = { ...process.env, TMPDIR: path.join(root, 'tmp') };
    delete env.NODE_TEST_CONTEXT;
    fs.mkdirSync(env.TMPDIR);
    // Python 3.12 first on PATH, as the bench pins it for a run whose checks name python.
    const py = resolvePython({ env, want: wantedVersion(path.join(DIR, '..', '..')) });
    if (py.executable) env.PATH = [linkPython(root, py.executable, py.version), env.PATH].join(path.delimiter);
    const hiddenDir = path.join(dir, 'hidden', id);
    const out = { id, repeat, reference: null, stub: null, shallow: null, lazy: null, alt: null, deterministic: true, canary: null };
    // The lazy and alternative answers (answers/<id>/lazy and answers/<id>/alt) are scored once each when present.
    const answerDir = (k) => path.join(dir, 'answers', id, k);
    const modes = [['reference', path.join(dir, 'solutions', id)], ['stub', null], ['shallow', shallowOverlay(root, path.join(dir, 'solutions', id))]];
    for (const k of ['lazy', 'alt']) if (fs.existsSync(answerDir(k))) modes.push([k, answerDir(k)]);
    for (const [mode, overlay] of modes) {
      const ref = mode === 'reference';
      const ws = workspace(root, task, mode, overlay, dir);
      const runs = [];
      for (let i = 0; i < (ref || mode === 'stub' ? repeat : 1); i++) runs.push(runChecks(task, ws, hiddenDir, dir, env, path.join(root, 'scratch')));
      if (new Set(runs.map(signature)).size > 1) out.deterministic = false;
      out[mode] = { ...scoreOf(runs[0]), checks_: runs[0].map((r) => ({ type: r.type, kind: r.kind, weight: r.weight, passed: r.passed, detail: r.detail })) };
      if (ref) {
        const base = runs[0].find((r) => r.type === 'tests');
        out.canary = canary(task, hiddenDir, ws, env, path.join(root, 'scratch'), base.tests);
      }
    }
    out.pass = out.reference.score >= 95 && out.stub.score <= 20 && out.deterministic && out.canary.ok;
    // Gates added 2026-11-19: a lazy answer scores 40 or less, an alternative correct answer 80 or more (each only when present).
    out.answersPass = out.shallow.score <= 40 && (!out.lazy || out.lazy.score <= 40) && (!out.alt || out.alt.score >= 80);
    out.answersPresent = Boolean(out.lazy && out.alt);
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const id = args.find((a, i) => !a.startsWith('--') && !['--repeat', '--dir'].includes(args[i - 1]));
  const repeat = args.includes('--repeat') ? Number(args[args.indexOf('--repeat') + 1]) : 3;
  const dir = args.includes('--dir') ? path.resolve(args[args.indexOf('--dir') + 1]) : DIR;
  const res = dryRun(id, { repeat, dir });
  const brief = (m) => (m ? { score: Number(m.score.toFixed(1)), hidden: m.hidden, checks: m.checks } : null);
  console.log(JSON.stringify(args.includes('--json') ? res : { id, reference: brief(res.reference), stub: brief(res.stub), shallow: brief(res.shallow), lazy: brief(res.lazy), alt: brief(res.alt), deterministic: res.deterministic, canary: res.canary, pass: res.pass, answersPass: res.answersPass }, null, 2));
  if (!res.pass || !res.answersPass) process.exitCode = 1;
}

module.exports = { scoreOf, dryRun, isCode };
