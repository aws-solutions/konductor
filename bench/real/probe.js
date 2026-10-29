// SPDX-License-Identifier: Apache-2.0
'use strict';

// Proves from inside a test run that the code under test is the source tree in the working directory and
// not a copy installed on the host. An interpreter start-up hook (sitecustomize.py for Python, a --require
// script for Node) appends one line per watched module to a file when the process exits. This covers every
// process the run starts, including test sub-processes that inherit the environment.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PY_HOOK = `import atexit, os, sys


def _dump():
    out = os.environ.get("BENCH_PROBE_OUT")
    if not out:
        return
    with open(out, "a") as f:
        for name in os.environ.get("BENCH_PROBE_MODULES", "").split(","):
            mod = sys.modules.get(name) if name else None
            if mod is not None:
                f.write("py\\t%s\\t%s\\n" % (name, getattr(mod, "__file__", None) or ""))


atexit.register(_dump)
`;

const NODE_HOOK = `'use strict';
process.on('exit', () => {
  const out = process.env.BENCH_PROBE_OUT;
  if (!out) return;
  const cwd = process.cwd() + '/';
  const lines = Object.keys(require.cache)
    .filter((f) => f.startsWith(cwd) || f.includes('/node_modules/'))
    .map((f) => 'node\\t\\t' + f + '\\n');
  require('node:fs').appendFileSync(out, lines.join(''));
});
`;

function sh(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sitecustomize.py'), PY_HOOK);
  fs.writeFileSync(path.join(dir, 'node-probe.js'), NODE_HOOK);
}

/**
 * Creates the hook files in `dir` and returns the environment to add to the test command.
 * runner: 'pytest' or 'node-test'. existing: the spec's own env, so a PYTHONPATH it sets stays in force.
 */
function prepare(dir, { runner, modules, existing = {} }) {
  sh(dir);
  const out = path.join(dir, 'modules.tsv');
  fs.rmSync(out, { force: true });
  const env = { BENCH_PROBE_OUT: out, BENCH_PROBE_MODULES: modules.join(',') };
  if (runner === 'pytest') env.PYTHONPATH = [dir, existing.PYTHONPATH].filter(Boolean).join(path.delimiter);
  else env.NODE_OPTIONS = [existing.NODE_OPTIONS, `--require=${path.join(dir, 'node-probe.js')}`].filter(Boolean).join(' ');
  return { env, out };
}

// Returns {ok, problems, seen}. Python: each watched module must have been imported, from under `root`.
// Node: a watched package must never load from a node_modules directory, and some project file outside
// tests/ must have loaded from under `root`.
function evaluate(file, { runner, modules, root }) {
  const rows = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
    : [];
  const problems = [];
  const base = root.endsWith(path.sep) ? root : root + path.sep;
  const rel = (f) => (f.startsWith(base) ? f.slice(base.length) : f);
  if (runner === 'pytest') {
    for (const [, name, f] of rows) if (!f.startsWith(base)) problems.push(`${name} was loaded from ${f}, outside the task tree`);
    for (const m of modules) {
      if (!rows.some(([, name]) => name === m)) problems.push(`module ${m} was never imported, so its location is unproven`);
    }
  } else {
    for (const [, , f] of rows) {
      const hit = modules.find((m) => f.includes(`/node_modules/${m}/`));
      if (hit && !f.startsWith(base)) problems.push(`${hit} was loaded from ${f}, outside the task tree`);
    }
    if (!rows.some(([, , f]) => f.startsWith(base) && !rel(f).startsWith('tests/') && !f.includes('/node_modules/'))) {
      problems.push('no project source file was recorded as loaded, so its location is unproven');
    }
  }
  return { ok: problems.length === 0, problems, seen: [...new Set(rows.map(([, n, f]) => `${n ? `${n}=` : ''}${rel(f)}`))].sort().slice(0, 12) };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'real-probe-'));

module.exports = { prepare, evaluate, tmpDir };
