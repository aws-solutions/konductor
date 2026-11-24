// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench plant-host-check`: can this host make a counted plant run? Runs, with no model and no agent, the host-side
// checks a counted Kiro CLI plant suite meets before its first trial (intake.js, run-cmd.js, plant-wave.sh) and prints
// one PASS or FAIL line per gate with the fix. It is the test of the quiet-host recipe (D-95): the runner still makes
// every check itself at run time, so a PASS here never makes a run counted.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = require('../sandbox.js');
const { probeUnshare, realHomes, tmpOutsideHome } = require('../isolate.js');
const { intakeRelease, discardRelease, checkKiroPin, checkWheels, checkOutFilesystem } = require('./intake.js');
const { PINNED_KEYS } = require('./manifest.js');
const { hostNoise } = require('./walls.js');

// The host-load ceiling plant-wave.sh gates on (one-minute load average).
const LOAD_MAX = 4;
const DEFAULT_OUT = '/var/tmp';

const pass = (id, detail) => ({ id, status: 'pass', detail, fix: null });
const fail = (id, detail, fix) => ({ id, status: 'fail', detail, fix });
const skip = (id) => ({ id, status: 'skip', detail: 'not checked: the release did not pass intake', fix: null });
const info = (id, detail) => ({ id, status: 'info', detail, fix: null });

/** The `{id, status, ...}` of `check()`: pass with `ok`, or fail with the thrown message and `fix`. */
function attempt(id, check, ok, fix) {
  try {
    check();
    return pass(id, ok);
  } catch (e) {
    return fail(id, e.message, fix);
  }
}

/** The sandbox gate: Linux with user namespaces, the only comparable plant mode (`--isolate unshare`). */
function sandboxGate({ platform, probeUnshare: probe }) {
  if (platform !== 'linux') return fail('sandbox', `platform ${platform}: a counted plant run needs Linux`, 'run on a Linux host');
  const r = probe();
  return r.ok ? pass('sandbox', 'user namespaces work (--isolate unshare)')
    : fail('sandbox', `--isolate unshare is not usable: ${r.reason}`, 'use a host or VM whose kernel allows unprivileged user namespaces (sysctl kernel.unprivileged_userns_clone=1, user.max_user_namespaces > 0, no AppArmor userns restriction)');
}

/** The Kiro CLI the run would use: `kiroBin`, else the native binary on PATH. Throws when none is found. */
function kiroBinOf({ kiroBin, resolveKiroCli }) {
  return kiroBin ? path.resolve(kiroBin) : resolveKiroCli().bin;
}

/** The gates that read the checked release copy `rel`; see hostCheck for the facts in `h`. */
function releaseGates(rel, h) {
  const { manifest } = rel;
  const noise = h.noiseOf(rel);
  const strands = manifest.versions?.strands?.version;
  return [
    noise.length
      ? fail('quiet-host', `listeners outside the release allowlist: ${noise.join(', ')}`, 'stop each listed service (or run on a host without them); a listener the plant needs goes in the release network-allowlist.txt and is signed')
      : pass('quiet-host', 'no listener outside the release allowlist'),
    attempt('kiro-pin', () => checkKiroPin(kiroBinOf(h), manifest, h.versionOfBin, manifest.versions?.kiroCli?.engine),
      `Kiro CLI matches the pin ${manifest.versions?.kiroCli?.version} (run with --agent-engine ${manifest.versions?.kiroCli?.engine})`,
      'install the pinned Kiro CLI build, or pass its native binary with --kiro-bin PATH'),
    attempt('wheels', () => h.checkWheels(manifest.wheels, h.python), manifest.wheels ? 'the plant Python has the pinned wheels' : 'the release pins no wheels',
      'pip install the pinned wheels into the plant Python, or pass the right one with --plant-python PATH'),
    info('strands-pin', strands ? `the release pins strands-agents ${strands}` : 'the release pins no strands-agents version: a real Strands trial on it runs NOT COUNTED'),
  ];
}

/** Intakes the release into a new dir under `h.privateParent`, runs `releaseGates` on it and removes it again. */
function checkRelease(h) {
  const privateRoot = fs.mkdtempSync(path.join(h.privateParent, 'kplant-check-'));
  let rel = null;
  try {
    rel = intakeRelease({ dir: h.release, expectedSha256: h.sha256, privateRoot, keys: h.keys });
    if (rel.keyStatus === 'toy') return [fail('release', `release ${rel.manifest.release} is signed with the public toy key; it runs controls only and never counts`, 'sign the release with the owner key')];
    return [pass('release', `${rel.manifest.release}: signature and every file hash match`), ...releaseGates(rel, h)];
  } catch (e) {
    return [fail('release', e.message, 'pass the unpacked signed release and the manifest SHA-256 its sign step printed')];
  } finally {
    if (rel) discardRelease(rel.root);
    fs.rmSync(privateRoot, { recursive: true, force: true });
  }
}

/**
 * Runs every gate. `h` holds the inputs and the host seams: `release` (dir), `sha256` (manifest hash), `kiroBin`
 * (optional), `python` (plant Python, default python3), `outDir` (default /var/tmp), `keys`, `privateParent`, `platform`,
 * `probeUnshare`, `noiseOf(release)`, `loadavg`, `versionOfBin`, `resolveKiroCli`, `checkWheels`, `checkOutFilesystem`.
 * Returns `{ready, gates}`: ready only when no gate failed or was skipped. Each gate is `{id, status, detail, fix}`.
 */
function hostCheck(input) {
  const home = os.homedir();
  const h = {
    python: 'python3', outDir: DEFAULT_OUT, keys: PINNED_KEYS, privateParent: tmpOutsideHome(realHomes(home)), platform: process.platform,
    probeUnshare: () => probeUnshare(home), noiseOf: hostNoise, loadavg: os.loadavg, versionOfBin: sandbox.versionOf,
    resolveKiroCli: sandbox.resolveKiroCli, checkWheels, checkOutFilesystem, ...input,
  };
  const released = checkRelease(h);
  const byId = Object.fromEntries(released.map((g) => [g.id, g]));
  const load = h.loadavg()[0];
  const gates = [
    sandboxGate(h),
    byId.release,
    ...['quiet-host', 'kiro-pin', 'wheels'].map((id) => byId[id] ?? skip(id)),
    attempt('out-dir', () => {
      if (!fs.existsSync(h.outDir)) throw new Error(`${h.outDir} does not exist`);
      h.checkOutFilesystem(h.outDir, { scratch: os.tmpdir(), home });
    }, `${h.outDir} is on a filesystem of its own (not scratch, not home)`, 'put the out dir on its own filesystem, for example /var/tmp on a separate mount, with --out DIR'),
    load < LOAD_MAX ? pass('load', `one-minute load ${load.toFixed(2)}`) : fail('load', `one-minute load ${load.toFixed(2)} is not under ${LOAD_MAX}`, 'stop other work on the host and check again'),
    byId['strands-pin'] ?? skip('strands-pin'),
  ];
  return { ready: gates.every((g) => g.status === 'pass' || g.status === 'info'), gates };
}

/** The text report: one `STATUS  id  detail` line per gate, the fix under a failed one, then the verdict line. */
function formatHostCheck({ ready, gates }) {
  const lines = gates.flatMap((g) => [`${g.status.toUpperCase().padEnd(4)}  ${g.id.padEnd(11)} ${g.detail}`, ...(g.fix ? [`      fix: ${g.fix}`] : [])]);
  lines.push(`counted plant run here: ${ready ? 'YES' : 'NO'} (the runner repeats every check at run time; Kiro CLI login is checked by plant-wave.sh)`);
  return lines.join('\n');
}

/** `bench plant-host-check`. Exit 0 when ready, 1 when a gate fails, 2 on a usage error. `seams` and `log` are for tests. */
function cmdPlantHostCheck(opts, seams = {}, log = console.log) {
  const value = (k) => (opts[k] && opts[k] !== true ? opts[k] : null);
  if (!value('release') || !value('release-sha256')) {
    console.error('plant-host-check: --release DIR and --release-sha256 HEX are required');
    process.exitCode = 2;
    return;
  }
  const given = { release: value('release'), sha256: value('release-sha256'), kiroBin: value('kiro-bin') };
  if (value('plant-python')) given.python = value('plant-python');
  if (value('out')) given.outDir = value('out');
  const result = hostCheck({ ...given, ...seams });
  log(opts.json ? JSON.stringify(result, null, 2) : formatHostCheck(result));
  process.exitCode = result.ready ? 0 : 1;
}

module.exports = { hostCheck, formatHostCheck, cmdPlantHostCheck, LOAD_MAX };
