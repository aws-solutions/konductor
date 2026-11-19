// SPDX-License-Identifier: Apache-2.0
'use strict';

// Mutant runner for T5 test-writing tasks.
// A task's hidden dir holds `mutants.json` and one overlay dir per mutant:
//   { "testCmd": "node --test --test-timeout=5000", "runner": "node"|"python",
//     "pristine": ["src/a.js"],                   // files restored from hidden/pristine/ before every run
//     "mutants": [{ "id": "m01", "files": ["src/a.js"], "note": "..." }] }
//   hidden/pristine/<path>        the real source files
//   hidden/mutants/<id>/<path>    the mutated version of each listed file
// Score = fraction of mutants killed by the workspace's tests, counted only when the tests pass on the real code.
// A kill is a non-zero exit or a timeout. Python runs get a per-test alarm so one hang fails alone.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

const copyTree = (from, to) => fs.cpSync(from, to, { recursive: true, filter: (s) => !/(^|\/)(\.git|node_modules|__pycache__)(\/|$)/.test(s) });

function overlay(dest, srcRoot, files) {
  for (const f of files) {
    const target = path.join(dest, f);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(srcRoot, f), target);
  }
}

// node:test sets NODE_TEST_CONTEXT in its children; a nested `node --test` would then print nothing and exit 0.
function childEnv(cwd) {
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: cwd };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runTests(cwd, cfg, timeoutMs) {
  const [cmd, ...args] = cfg.runner === 'python'
    ? ['python3', '-c', PY_BOOT, String(cfg.perTestSec || 5), 'discover', '-s', cfg.testDir || 'tests', '-t', '.']
    : cfg.testCmd.split(/\s+/);
  // GNU timeout puts the command in its own process group and kills the group, so a spinning grandchild dies too.
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
  const r = spawnSync('timeout', ['-s', 'KILL', String(secs), cmd, ...args], { cwd, timeout: timeoutMs + 5000, encoding: 'utf8', killSignal: 'SIGKILL', env: childEnv(cwd) });
  return { exit: r.status, timedOut: r.status === 137 || r.error?.code === 'ETIMEDOUT', tail: `${r.stdout || ''}${r.stderr || ''}`.slice(-400) };
}

// workspace: the agent's final repo. hiddenDir: the task's hidden dir. Returns {realPass, killed, total, score, results}.
function runMutants(workspace, hiddenDir, { suiteTimeoutMs = 60000 } = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(hiddenDir, 'mutants.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't5mut-'));
  try {
    const work = path.join(tmp, 'w');
    copyTree(workspace, work);
    fs.rmSync(path.join(work, 'hidden'), { recursive: true, force: true });
    const real = path.join(hiddenDir, 'pristine');
    overlay(work, real, cfg.pristine);
    const base = runTests(work, cfg, suiteTimeoutMs);
    const realPass = base.exit === 0 && !base.timedOut;
    const results = [];
    for (const m of cfg.mutants) {
      let killed = false, detail = 'not run: tests fail on the real code';
      if (realPass) {
        overlay(work, real, cfg.pristine);
        overlay(work, path.join(hiddenDir, 'mutants', m.id), m.files);
        const r = runTests(work, cfg, suiteTimeoutMs);
        killed = r.exit !== 0 || r.timedOut;
        detail = r.timedOut ? 'killed by timeout' : killed ? 'killed' : 'survived';
      }
      results.push({ id: m.id, killed, detail });
    }
    const killedN = results.filter((x) => x.killed).length;
    return { realPass, realTail: realPass ? '' : base.tail, killed: killedN, total: cfg.mutants.length, score: realPass ? killedN / cfg.mutants.length : 0, results };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { runMutants, runTests };

if (require.main === module) {
  const [ws, hid] = process.argv.slice(2);
  if (!ws || !hid) { console.error('usage: mutants.js <workspace> <hiddenDir>'); process.exit(2); }
  const out = runMutants(path.resolve(ws), path.resolve(hid));
  console.log(JSON.stringify(out, null, 2));
}
