// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Python pin (S6): which tasks need Python, how the interpreter is chosen, the python3 link dir first on PATH, and
// the refusals. Fake interpreters are shell scripts that print what a real one would; no real Python runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pinPython, resolvePython, needsPython } = require('../lib/python-pin.js');
const { tmp } = require('./helpers.js');

const BENCH = path.join(__dirname, '..', '..');

// A fake interpreter at <dir>/<name> that reports itself as `version`.
function fakePython(dir, name, version) {
  const file = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\necho "${file}"\necho "${version}"\n`, { mode: 0o755 });
  return file;
}

function setup(t) {
  const root = tmp();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sys = path.join(root, 'sys');
  const shim = path.join(root, 'shim');
  fakePython(sys, 'python3', '3.9.25');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  return { root, sys, shim, scratchDir };
}

const pyTask = { id: 'py', checks: [{ type: 'cmd', cmd: 'python3 -m pytest -q' }] };
const nodeTask = { id: 'js', checks: [{ type: 'cmd', cmd: 'node --test' }] };

test('needsPython: python or pytest in a check or a real test command, or a plant task', () => {
  assert.equal(needsPython(pyTask), true);
  assert.equal(needsPython(nodeTask), false);
  assert.equal(needsPython({ id: 'r', checks: [], realEntry: { test: { runner: 'pytest', cmd: 'pytest -v' } } }), true);
  assert.equal(needsPython({ id: 'p', checks: [], environment: { kind: 'conveyor-sim' } }), true);
});

test('resolvePython takes --python, then BENCH_PYTHON, then python3.12, then python3, and only a 3.12', (t) => {
  const d = setup(t);
  const env = { PATH: `${d.shim}:${d.sys}` };
  assert.equal(resolvePython({ env, want: '3.12' }).executable, null);
  const shim = fakePython(d.shim, 'python3.12', '3.12.15');
  assert.deepEqual(resolvePython({ env, want: '3.12' }).executable, shim);
  const own = fakePython(path.join(d.root, 'own'), 'py', '3.12.1');
  assert.equal(resolvePython({ env: { ...env, BENCH_PYTHON: own }, want: '3.12' }).source, 'BENCH_PYTHON');
  const old = fakePython(path.join(d.root, 'old'), 'py', '3.11.2');
  const r = resolvePython({ flag: old, env, want: '3.12' });
  assert.equal(r.executable, null, 'an explicit --python of the wrong version is refused, not replaced');
  assert.match(r.tried.join(';'), /3\.11\.2/);
});

test('pinPython puts a python3 link to the 3.12 interpreter first on PATH and records it', (t) => {
  const d = setup(t);
  const shim = fakePython(d.shim, 'python3.12', '3.12.15');
  const env = { PATH: `${d.sys}:${d.shim}` };
  const pin = pinPython({ tasks: [pyTask, nodeTask], scratchDir: d.scratchDir, benchDir: BENCH, env });
  assert.equal(pin.version, '3.12.15');
  assert.equal(pin.sandboxVersion, '3.12.15');
  assert.equal(env.PATH.split(':')[0], pin.binDir);
  for (const n of ['python3', 'python', 'python3.12']) assert.match(fs.readFileSync(path.join(pin.binDir, n), 'utf8'), new RegExp(`^#!/bin/sh\\nexec '${shim}' "\\$@"\\n$`), 'a launcher script is run by its real path, not linked');
  assert.deepEqual(fs.readdirSync(d.scratchDir), ['python-bin'], 'the probe HOME is removed');
});

test('a python3.12 wrapper that finds its interpreter next to itself still works once pinned (D-121)', (t) => {
  const d = setup(t);
  const wrapper = path.join(d.shim, 'python3.12');
  fs.mkdirSync(d.shim, { recursive: true });
  // Like the Kiro Crew runtime: the wrapper execs the interpreter beside it, which reports the wrapper as sys.executable.
  fs.writeFileSync(path.join(d.shim, 'real-py'), `#!/bin/sh\necho "${wrapper}"\necho "3.12.15"\n`, { mode: 0o755 });
  fs.writeFileSync(wrapper, '#!/bin/sh\nexec "$(/usr/bin/dirname "$0")/real-py" "$@"\n', { mode: 0o755 });
  const env = { PATH: `${d.sys}:${d.shim}` };
  const pin = pinPython({ tasks: [pyTask], scratchDir: d.scratchDir, benchDir: BENCH, env });
  assert.equal(pin.sandboxVersion, '3.12.15', 'python3 under the scratch HOME runs the wrapper from its own directory');
});

test('a real interpreter binary is linked, not wrapped', (t) => {
  const d = setup(t);
  const { linkPython } = require('../lib/python-pin.js');
  const bin = path.join(d.root, 'python3.12');
  fs.writeFileSync(bin, '\x7fELF fake');
  const dir = linkPython(d.scratchDir, bin, '3.12.15');
  assert.equal(fs.readlinkSync(path.join(dir, 'python3')), bin);
});

test('pinPython refuses when tasks run Python and no 3.12 is found, and does nothing when none does', (t) => {
  const d = setup(t);
  const env = { PATH: d.sys };
  assert.throws(() => pinPython({ tasks: [pyTask], scratchDir: d.scratchDir, benchDir: BENCH, env }), /refused: 1 task\(s\) run Python \(py\) and need Python 3\.12, but none was found \(.*python3: 3\.9\.25/);
  assert.equal(pinPython({ tasks: [nodeTask], scratchDir: d.scratchDir, benchDir: BENCH, env }), null);
  assert.equal(env.PATH, d.sys, 'PATH is unchanged without a pin');
});

test('pinPython refuses a plant run whose --plant-python is not 3.12', (t) => {
  const d = setup(t);
  fakePython(d.shim, 'python3.12', '3.12.15');
  const venv = fakePython(path.join(d.root, 'venv', 'bin'), 'python', '3.10.4');
  const plant = { id: 'p', checks: [], environment: { kind: 'conveyor-sim' } };
  assert.throws(() => pinPython({ tasks: [plant], scratchDir: d.scratchDir, benchDir: BENCH, plantPython: venv, env: { PATH: `${d.sys}:${d.shim}` } }), /--plant-python .* is Python 3\.10\.4, not 3\.12/);
});

test('pinPython refuses a plant run whose gateway Python cannot import its modules, with the install line (D-180)', (t) => {
  const d = setup(t);
  fakePython(d.shim, 'python3.12', '3.12.15');
  // A 3.12 that reports its version but fails any import: the gateway would die at start in every trial.
  const venv = path.join(d.root, 'venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(venv), { recursive: true });
  fs.writeFileSync(venv, `#!/bin/sh\ncase "$3" in "import sys"*) ;; import*) echo "ModuleNotFoundError: No module named '\${3#import }'" >&2; exit 1 ;; esac\necho "${venv}"\necho 3.12.15\n`, { mode: 0o755 });
  const conveyor = { id: 'p', checks: [], environment: { kind: 'conveyor-sim' } };
  const arm = { id: 'a', checks: [], environment: { kind: 'arm-sim' } };
  const env = () => ({ PATH: `${d.sys}:${d.shim}` });
  assert.throws(() => pinPython({ tasks: [conveyor], scratchDir: d.scratchDir, benchDir: BENCH, plantPython: venv, env: env() }), /plant Python .* cannot import cedarpy .*pip install cedarpy==4\.12\.2,/);
  assert.throws(() => pinPython({ tasks: [conveyor, arm], scratchDir: d.scratchDir, benchDir: BENCH, plantPython: venv, env: env() }), /cannot import cedarpy, mujoco, numpy .*pip install cedarpy==4\.12\.2 mujoco==3\.13\.0 numpy==2\.5\.5/);
  const good = fakePython(path.join(d.root, 'good', 'bin'), 'python', '3.12.15');
  assert.equal(pinPython({ tasks: [conveyor], scratchDir: d.scratchDir, benchDir: BENCH, plantPython: good, env: env() }).plantPython.cmd, good);
});
