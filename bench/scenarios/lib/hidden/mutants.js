// SPDX-License-Identifier: Apache-2.0
'use strict';

// Mutant runner for T5 test-writing tasks. The hidden dir of a task (copied as `mutation-kit/`) holds
// `mutants.json`, `pristine/` and `mutants/<id>/`:
//   mutants.json: { "runner": "node"|"python", "testCmd": "node --test test", "pattern": "test*.py", "perTestSec": 5,
//                   "pristine": ["src/a.js"], "mutants": [{ "id": "m01", "files": ["src/a.js"], "note": "..." }] }
//   pristine/<path>        the real source files, restored before every run
//   mutants/<id>/<path>    the mutated version of each file the mutant lists
//   refactors/<id>/<path>  optional: a behaviour-preserving rewrite of each file listed in "refactors": [{ id, files, note }]
//   "maxTests": N          optional: the suite-size budget (test definitions in the workspace's test files)
//   "baseTests": N         optional: test definitions the fixture starts with; refactor and size tests need more
// A mutant is killed when the workspace's tests exit non-zero or hang, and the same tests pass on the real code and on
// every safe refactor.
// Python runs get a per-test alarm so one hung test fails alone; node runs use `--test-timeout` in testCmd.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const EXCLUDE = ['hidden', 'mutation-kit', 'mutation.test.js'];

const PY_BOOT = [
  'import runpy, signal, sys, unittest',
  'LIMIT = int(sys.argv[1]); del sys.argv[1]',
  'orig = unittest.TestCase.run',
  'def run(self, result=None):',
  '    def boom(s, f): raise TimeoutError("test exceeded %ds" % LIMIT)',
  '    prev = signal.signal(signal.SIGALRM, boom); signal.alarm(LIMIT)',
  '    try: return orig(self, result)',
  '    finally: signal.alarm(0); signal.signal(signal.SIGALRM, prev)',
  'unittest.TestCase.run = run',
  'runpy.run_module("unittest", run_name="__main__", alter_sys=True)',
].join('\n');

// node:test sets NODE_TEST_CONTEXT in its children; a nested `node --test` would then print nothing and exit 0.
function childEnv(cwd) {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: cwd };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const skipCopy = (src) => !/(^|\/)(\.git|node_modules|__pycache__)(\/|$)/.test(src);

function overlay(dest, srcRoot, files) {
  for (const f of files) {
    const target = path.join(dest, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, f), target);
  }
}

function runTests(cwd, cfg, timeoutMs) {
  const [cmd, ...args] = cfg.runner === 'python'
    ? ['python3', '-c', PY_BOOT, String(cfg.perTestSec || 5), 'discover', '-s', '.', '-p', cfg.pattern || 'test*.py', '-t', '.']
    : cfg.testCmd.split(/\s+/);
  // GNU timeout puts the command in its own process group and kills the group, so a spinning grandchild dies too.
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const r = spawnSync('timeout', ['-s', 'KILL', String(secs), cmd, ...args], { cwd, timeout: timeoutMs + 5000, encoding: 'utf8', killSignal: 'SIGKILL', env: childEnv(cwd) });
  return { exit: r.status, timedOut: r.status === 137 || r.error?.code === 'ETIMEDOUT', tail: `${r.stdout || ''}${r.stderr || ''}`.slice(-400) };
}

// Copies the workspace to a scratch dir, restores the real source and runs the tests once.
function prepare(workspace, hiddenDir, { suiteTimeoutMs = 8000 } = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(hiddenDir, 'mutants.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't5mut-'));
  const work = path.join(tmp, 'w');
  fs.cpSync(workspace, work, { recursive: true, filter: skipCopy });
  for (const name of EXCLUDE) fs.rmSync(path.join(work, name), { recursive: true, force: true });
  const real = path.join(hiddenDir, 'pristine');
  overlay(work, real, cfg.pristine);
  const base = runTests(work, cfg, suiteTimeoutMs);
  return { cfg, tmp, work, real, hiddenDir, suiteTimeoutMs, realPass: base.exit === 0 && !base.timedOut, realTail: base.tail };
}

function runOne(ctx, m) {
  if (!ctx.realPass) return { id: m.id, killed: false, detail: 'tests fail on the real code' };
  overlay(ctx.work, ctx.real, ctx.cfg.pristine);
  overlay(ctx.work, path.join(ctx.hiddenDir, 'mutants', m.id), m.files);
  const r = runTests(ctx.work, ctx.cfg, ctx.suiteTimeoutMs);
  const killed = r.exit !== 0 || r.timedOut;
  return { id: m.id, killed, detail: r.timedOut ? 'killed by timeout' : killed ? 'killed' : 'survived' };
}

// A safe refactor (refactors/<id>/<path>) keeps the behaviour and changes the internals. A suite that fails on one
// pins internals: it would also "kill" every mutant without telling right from wrong, so kills only count when the
// suite passes every safe refactor.
function runRefactor(ctx, r) {
  if (!ctx.realPass) return { id: r.id, passed: false, detail: 'tests fail on the real code' };
  overlay(ctx.work, ctx.real, ctx.cfg.pristine);
  overlay(ctx.work, path.join(ctx.hiddenDir, 'refactors', r.id), r.files);
  const res = runTests(ctx.work, ctx.cfg, ctx.suiteTimeoutMs);
  overlay(ctx.work, ctx.real, ctx.cfg.pristine);
  const passed = res.exit === 0 && !res.timedOut;
  return { id: r.id, passed, detail: passed ? 'passed' : `failed on a behaviour-preserving rewrite: ${res.tail.slice(-200)}` };
}

/** True when the suite passes every safe refactor of the kit (computed once per context). */
function refactorsPass(ctx) {
  if (ctx.refactorsPass === undefined) ctx.refactorsPass = (ctx.cfg.refactors || []).every((r) => runRefactor(ctx, r).passed);
  return ctx.refactorsPass;
}

const TEST_DEF = { python: /^[ \t]*(?:async[ \t]+)?def[ \t]+test\w*[ \t]*\(/gm, node: /(?:^|[^\w.])(?:test|it)(?:\.only|\.skip|\.todo)?[ \t]*\(/gm };

/** Number of test definitions in the workspace's own test files (python: def test_*, node: test( and it( calls). */
function countTests(ctx) {
  const py = ctx.cfg.runner === 'python';
  const isTest = py ? (n) => /^test.*\.py$/.test(n) : (n) => /\.test\.[cm]?js$/.test(n);
  let n = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (skipCopy(p)) walk(p); } else if (isTest(e.name)) n += (fs.readFileSync(p, 'utf8').match(TEST_DEF[py ? 'python' : 'node']) || []).length;
    }
  };
  walk(ctx.work);
  return n;
}

const cleanup = (ctx) => fs.rmSync(ctx.tmp, { recursive: true, force: true });

// Whole run: {realPass, refactorsPass, killed, total, score, results}. Score is 0 unless the tests pass on the real
// code and on every safe refactor.
function runMutants(workspace, hiddenDir, opts) {
  const ctx = prepare(workspace, hiddenDir, opts);
  try {
    const safe = refactorsPass(ctx);
    const results = ctx.cfg.mutants.map((m) => runOne(ctx, m));
    const killed = results.filter((x) => x.killed).length;
    const ok = ctx.realPass && safe;
    return { realPass: ctx.realPass, refactorsPass: safe, realTail: ctx.realPass ? '' : ctx.realTail, killed, total: results.length, score: ok ? killed / results.length : 0, results };
  } finally {
    cleanup(ctx);
  }
}

module.exports = { prepare, runOne, runRefactor, refactorsPass, countTests, cleanup, runMutants, runTests };

if (require.main === module) {
  const [ws, hid] = process.argv.slice(2);
  if (!ws || !hid) { console.error('usage: mutants.js <workspace> <hiddenDir>'); process.exit(2); }
  console.log(JSON.stringify(runMutants(path.resolve(ws), path.resolve(hid)), null, 2));
}
