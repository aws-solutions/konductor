#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// A masked package directory is an empty tmpfs, which Python still imports as an empty namespace package
// (no __file__, no modules inside); the probe accepts that and a plain ImportError.
// Shows that the namespace hides everything a real task's fix could be read from, with plain shell probes run
// twice: on the host, and inside the same unshare command line a run uses (makeIso from run-one.js with the
// hide and mask lists that run-cmd.js builds). Prints one table; exit 1 when a probe that must be hidden is not.
//
//   BENCH_HIDE_EXTRA=<extra paths to hide> node bench/real/prove-mask.js [--cache DIR] [--ids a,b] [--json FILE]
//
// Nothing is written outside a scratch directory, no agent is started and no model is called.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('./lib.js');
const mask = require('../runner/lib/real-mask.js');
const { loadTasks, benchMask } = require('../runner/lib/tasks.js');
const { makeIso } = require('../runner/lib/run-one.js');
const { resolveIsolation } = require('../runner/lib/isolate.js');
const { makeScratchRoot } = require('../runner/lib/sandbox.js');

const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A name that appears in the real fix and nowhere in the base tree, for tasks where one exists.
const MARKERS = {
  'rich-3938-soft-wrap-style': 'split_lines_terminator',
  'rich-3934-empty-live': 'last_render_height',
  'click-3473-argument-help': 'format_arguments',
  'markdown-it-py-379-cli-stdin': 'convert_stdin',
};

function run(wrap, script, cwd) {
  const w = wrap ? wrap('sh', ['-c', script]) : { file: 'sh', args: ['-c', script] };
  const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 90000, cwd });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function probesFor(task, { home, benchDir, cache, outDir }) {
  const entry = task.realEntry;
  const out = [];
  const add = (name, script, mustBeHidden, expect) => out.push({ name, script, mustBeHidden, expect });
  const sp = mask.sitePackagesDirs(home).find((d) => d.includes('3.12')) || mask.sitePackagesDirs(home)[0];
  const countIn = (dir) => `[ -d ${shq(dir)} ] && ls -A ${shq(dir)} 2>/dev/null | wc -l || echo absent`;
  if (entry.language === 'python') {
    for (const m of entry.test.probeModules) {
      add(`python: import ${m} from a neutral directory`, `cd "$HOME" 2>/dev/null || cd /; python3 -c "import importlib.util; s = importlib.util.find_spec('${m}'); print(s.origin if s else 'not importable')"`, true, ['None', 'not importable']);
      add(`python: modules inside the host ${m} package`, `cd "$HOME" 2>/dev/null || cd /; python3 -c "import pkgutil, importlib; m = importlib.import_module('${m}'); print(len(list(pkgutil.iter_modules(m.__path__))))"`, true, ['0']);
      add(`host copy dir ${m} (entries)`, countIn(path.join(sp, m)), true, ['0', 'absent']);
    }
    if (MARKERS[entry.id]) {
      const dirs = entry.test.probeModules.map((m) => shq(path.join(sp, m))).join(' ');
      add(`grep for the fix identifier "${MARKERS[entry.id]}" in the host site-packages copy`, `grep -rl --include='*.py' ${MARKERS[entry.id]} ${dirs} 2>/dev/null | wc -l`, true, ['0', 'absent']);
    }
    add('python still works: pytest imports', 'python3 -c "import pytest; print(\'pytest\', pytest.__version__)"', false, ['pytest']);
  } else {
    add('node still works', 'node -e "console.log(\'node\', process.version)"', false, ['node']);
  }
  add('package cache ~/.cache/uv (entries)', countIn(path.join(home, '.cache/uv')), true, ['0', 'absent']);
  add('package cache ~/.cache/pip (entries)', countIn(path.join(home, '.cache/pip')), true, ['0', 'absent']);
  add('upstream cache (entries)', countIn(cache), true, ['0', 'absent']);
  add('upstream bare repository of this task (entries)', countIn(path.join(cache, entry.id)), true, ['0', 'absent']);
  add('bench/real (entries)', countIn(path.join(benchDir, 'real')), true, ['0', 'absent']);
  add('bench/tasks/hidden (entries)', countIn(path.join(benchDir, 'tasks/hidden')), true, ['0', 'absent']);
  for (const d of ['partials', 'solutions', 'stubs']) add(`bench/tasks/${d} (entries)`, countIn(path.join(benchDir, 'tasks', d)), true, ['0', 'absent']);
  add('bench/fixtures (entries)', countIn(path.join(benchDir, 'fixtures')), true, ['0', 'absent']);
  add('answer keys with content under bench', `find ${shq(benchDir)} -name .bench-answer-key.md -size +0 2>/dev/null | wc -l`, true, ['0', 'absent']);
  add('results directory of this run (entries)', countIn(outDir), true, ['0', 'absent']);
  return out;
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  const benchDir = lib.BENCH_DIR;
  const cache = lib.resolveCache(args.cache);
  const tasks = [...loadTasks(benchDir).values()].filter((t) => t.real && (!args.ids || args.ids.split(',').includes(t.real)));
  const home = fs.realpathSync(os.homedir());
  const iso = resolveIsolation('unshare');
  const scratchBase = makeScratchRoot();
  const outDir = path.join(scratchBase, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'marker'), 'x');
  const ctx = {
    isolation: iso, realCache: cache, hide: list(process.env.BENCH_HIDE_EXTRA), mask: [...benchMask(benchDir), outDir], keyRoots: [benchDir],
    kiroBin: null,
  };
  const arm = { id: 'vanilla', vanilla: true };
  const rows = [];
  let bad = 0;
  try {
    for (const task of tasks) {
      const runRoot = fs.mkdtempSync(path.join(scratchBase, 'r-'));
      const isoRun = makeIso(ctx, arm, runRoot, task);
      for (const p of probesFor(task, { home, benchDir, cache, outDir })) {
        const host = run(null, p.script, runRoot);
        const ns = run(isoRun.wrap, p.script, runRoot);
        const last = ns.out.split('\n').pop();
        const ok = p.mustBeHidden ? p.expect.includes(last) : p.expect.some((e) => ns.out.includes(e));
        if (!ok) bad++;
        rows.push({ task: task.real, probe: p.name, host: host.out.split('\n').pop(), namespace: ns.out.split('\n').pop(), ok });
      }
    }
  } finally {
    fs.rmSync(scratchBase, { recursive: true, force: true });
  }
  const tilde = (s) => String(s).split(home).join('~');
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.task} | ${tilde(r.probe)} | host: ${tilde(r.host)} | namespace: ${tilde(r.namespace)}`);
  console.log(`${rows.length} probes, ${bad} not as expected`);
  if (args.json) fs.writeFileSync(args.json, `${JSON.stringify(rows.map((r) => ({ ...r, probe: tilde(r.probe), host: tilde(r.host), namespace: tilde(r.namespace) })), null, 2)}\n`);
  if (bad) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { probesFor };
