// SPDX-License-Identifier: Apache-2.0
'use strict';

// The bench's Python pin (S6). Task checks that run Python (pytest tasks, real Python repos) and the plant gateway must
// see the Python the tasks were validated with (bench/tasks/toolchain/pins.json `global.python3`, 3.12). A version
// manager shim (mise, pyenv) finds its interpreter from the real HOME, so inside a run, where HOME is a scratch dir, a bare
// `python3` falls back to the system one. The pin resolves a matching interpreter once, with the real environment,
// links it as python3, python and python3.<minor> in a dir of the run's scratch root, and puts that dir first on PATH.
// `prepare` (a run, or --prepare-only) refuses when no matching interpreter is found, or when python3 under a scratch
// HOME is still another version.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const toolchain = require('./toolchain.js');

const DEFAULT_WANT = '3.12';
const PROBE = 'import sys; print(sys.executable); print("%d.%d.%d" % sys.version_info[:3])';
const PY_WORDS = /\b(python3?(\.\d+)?|pytest)\b/i;

/** The pinned python3 version prefix from the pin file, else 3.12. */
const wantedVersion = (benchDir) => toolchain.loadPins(benchDir)?.global?.python3 ?? DEFAULT_WANT;

/** { executable, version } of interpreter `cmd` run with `env`, or null when it does not start. */
function probe(cmd, env) {
  const r = spawnSync(cmd, ['-I', '-c', PROBE], { encoding: 'utf8', env, timeout: 15000 });
  if (r.status !== 0 || !r.stdout) return null;
  const [executable, version] = r.stdout.trim().split('\n');
  return executable && version ? { executable, version } : null;
}

/** True when a task runs Python: a check or a real repo's test command names python or pytest, or it is a plant task. */
function needsPython(task) {
  if (task.environment) return true;
  return PY_WORDS.test(JSON.stringify(task.checks ?? [])) || PY_WORDS.test(JSON.stringify(task.realEntry?.test ?? null));
}

/**
 * The first candidate whose version matches `want`: `--python`, then BENCH_PYTHON, then python<want> and python3 on PATH.
 * Returns { executable, version, source, tried } with executable null when none matched.
 */
function resolvePython({ flag = null, env = process.env, want = DEFAULT_WANT } = {}) {
  const candidates = [[flag, '--python'], [env.BENCH_PYTHON, 'BENCH_PYTHON'], [`python${want}`, 'PATH'], ['python3', 'PATH']].filter(([c]) => c);
  const tried = [];
  for (const [cmd, source] of candidates) {
    const p = probe(cmd, env);
    tried.push(`${cmd}: ${p ? p.version : 'not found'}`);
    if (p && toolchain.versionMatches(want, p.version)) return { executable: p.executable, version: p.version, source, tried };
    if (source === '--python') break; // an explicit choice that does not match is an error, not a hint
  }
  return { executable: null, version: null, source: null, tried };
}

// A launcher script (a version manager shim or a runtime wrapper, which starts `#!`) finds the real interpreter from
// its own path, so a link to it under another name breaks it (exit 127, DEBT D-121); such an executable gets a small
// script that execs it by its real path instead of a link.
function isScript(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try { const b = Buffer.alloc(2); return fs.readSync(fd, b, 0, 2, 0) === 2 && b.toString('latin1') === '#!'; } finally { fs.closeSync(fd); }
  } catch { return false; }
}
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Links `executable` as python3, python and python<major.minor> in <scratchDir>/python-bin and returns that dir. */
function linkPython(scratchDir, executable, version) {
  const dir = path.join(scratchDir, 'python-bin');
  fs.mkdirSync(dir, { recursive: true });
  const minor = version.split('.').slice(0, 2).join('.');
  const script = isScript(executable);
  for (const name of ['python3', 'python', `python${minor}`]) {
    const file = path.join(dir, name);
    fs.rmSync(file, { force: true });
    if (script) fs.writeFileSync(file, `#!/bin/sh\nexec ${shQuote(executable)} "$@"\n`, { mode: 0o755 });
    else fs.symlinkSync(executable, file);
  }
  return dir;
}

/** The modules each plant kind's gateway imports, and the exact wheels the arm test ran on (one list, DEBT D-179). */
const GATEWAY_MODULES = Object.freeze({ 'conveyor-sim': ['cedarpy'], 'arm-sim': ['cedarpy', 'mujoco', 'numpy'] });
const GATEWAY_WHEELS = Object.freeze(require('../../physical/gateway-wheels.json'));

/**
 * Throws the refusal unless interpreter `python`, run with `env` (the gateway's PATH, a scratch HOME and the dynamic-linker
 * path), imports every module the gateways of `plantTasks` need. Without it each trial would start a gateway that dies on
 * import and count as a launch failure (DEBT D-180).
 */
function checkGatewayModules(python, plantTasks, env) {
  const mods = [...new Set(plantTasks.flatMap((t) => GATEWAY_MODULES[t.environment.kind] ?? ['cedarpy']))];
  const r = spawnSync(python, ['-I', '-c', `import ${mods.join(', ')}`], { encoding: 'utf8', env, timeout: 60000 });
  if (r.status === 0) return;
  const why = (r.stderr || r.error?.message || `exit ${r.status}`).trim().split('\n').at(-1);
  throw new Error(`refused: the plant Python ${python} cannot import ${mods.join(', ')} (${why}). Install them into it: pip install ${mods.map((m) => `${m}==${GATEWAY_WHEELS[m]}`).join(' ')}, then pass --plant-python <that venv>/bin/python`);
}

/**
 * Pins Python for a run whose tasks need it, or returns null when none does. Puts the pinned dir first on
 * process.env.PATH (the agent, check and gateway environments inherit PATH) and checks python3 under a scratch HOME.
 * Throws the refusal otherwise. `plantPython` (the --plant-python value) is checked when the run has plant tasks.
 */
function pinPython({ tasks, scratchDir, benchDir, flag = null, plantPython = null, env = process.env }) {
  const needing = tasks.filter(needsPython);
  if (!needing.length) return null;
  const want = wantedVersion(benchDir);
  const r = resolvePython({ flag, env, want });
  const why = `${needing.length} task(s) run Python (${needing.slice(0, 3).map((t) => t.id).join(', ')}${needing.length > 3 ? ', ...' : ''})`;
  if (!r.executable) throw new Error(`refused: ${why} and need Python ${want}, but none was found (${r.tried.join('; ')}). Pass --python <a Python ${want} interpreter> or set BENCH_PYTHON`);
  const binDir = linkPython(scratchDir, r.executable, r.version);
  env.PATH = [binDir, ...(env.PATH ?? '').split(path.delimiter).filter((d) => d && d !== binDir)].join(path.delimiter);
  const home = fs.mkdtempSync(path.join(scratchDir, 'py-home-'));
  try {
    const inside = probe('python3', { PATH: env.PATH, HOME: home });
    if (!inside || !toolchain.versionMatches(want, inside.version)) throw new Error(`refused: python3 in the sandbox is ${inside?.version ?? 'missing'}, not ${want}, after pinning ${r.executable}`);
    const plantTasks = needing.filter((t) => t.environment);
    const plant = plantTasks.length && plantPython ? probe(plantPython, { PATH: env.PATH, HOME: home }) : null;
    if (plant && !toolchain.versionMatches(want, plant.version)) throw new Error(`refused: --plant-python ${plantPython} is Python ${plant.version}, not ${want}`);
    if (plantTasks.length) checkGatewayModules(plantPython ?? 'python3', plantTasks, { PATH: env.PATH, HOME: home, ...(env.LD_LIBRARY_PATH ? { LD_LIBRARY_PATH: env.LD_LIBRARY_PATH } : {}) });
    return { want, executable: r.executable, version: r.version, source: r.source, binDir, sandboxVersion: inside.version, plantPython: plant ? { ...plant, cmd: plantPython } : null };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = { pinPython, resolvePython, needsPython, linkPython, wantedVersion, probe, checkGatewayModules, GATEWAY_WHEELS, DEFAULT_WANT };
