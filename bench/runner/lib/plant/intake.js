// SPDX-License-Identifier: Apache-2.0
'use strict';

// Plant suite intake (7.1, SR-15, SR-19, SR-23, NFR-11): copies the release into a runner-private dir, checks it
// there, and refuses a suite whose paths, parallelism or Kiro CLI pin are wrong. Never reads the original dir again,
// never follows a link and never keeps a file the manifest does not list.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyPlainFile } = require('../safe-copy.js');
const { sha256File, versionOf, SHARED_LAUNCHER } = require('../sandbox.js');
const { isComparableMode, realHomes, tmpOutsideHome } = require('../isolate.js');
const { checkManifest, sha256Hex, ReleaseRefused, PINNED_KEYS, MANIFEST_FILE, SIGNATURE_FILE } = require('./manifest.js');
const { DEADLINES } = require('./gateway-proc.js');
const { loadRefusalRule } = require('./refusal.js');
const { readEnvironment, NOT_COUNTED } = require('./score.js');
const { AGENT_ENGINES } = require('../harness/runtime.js');
const { hostNoise } = require('./walls.js');
const procs = require('../procs.js');

const POLICY_FILES = ['policy/plant.cedar', 'policy/plant.cedarschema', 'sensor-limits.json'];
const REFUSAL_RULE = 'refusal-rule.json';
const SOCKET_PATH_MAX = 107;
// The socket root is `<parent>/s-XXXXXX` and the socket `gw.sock` inside it.
const SOCKET_SUFFIX_BYTES = '/s-XXXXXX/gw.sock'.length;

/** Why `st` (an lstat result) may not be copied, or null for a plain directory or a regular file with one link. */
function oddFileReason(st) {
  if (st.isSymbolicLink()) return 'a symlink';
  if (st.isDirectory()) return null;
  if (!st.isFile()) return 'not a regular file';
  return st.nlink > 1 ? 'a hard link' : null;
}

/** Copies the tree under `src` into `dest` (relative part `rel`), returning the copied file paths. Throws ReleaseRefused on an odd file. */
function copyTree(src, dest, rel = '') {
  const copied = [];
  for (const name of fs.readdirSync(path.join(src, rel)).sort()) {
    const relPath = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(src, relPath));
    const why = oddFileReason(st);
    if (why) throw new ReleaseRefused(`release file ${relPath} is ${why}`);
    if (st.isDirectory()) {
      fs.mkdirSync(path.join(dest, relPath), { mode: 0o700 });
      copied.push(...copyTree(src, dest, relPath));
    } else {
      copyPlainFile(src, relPath, path.join(dest, relPath));
      copied.push(relPath);
    }
  }
  return copied;
}

/** Throws ReleaseRefused unless the copied paths are exactly the manifest's files plus the manifest and its signature. */
function checkListedExactly(copied, manifest) {
  const listed = new Set([MANIFEST_FILE, SIGNATURE_FILE, ...manifest.files.map((f) => f.path)]);
  const extra = copied.filter((p) => !listed.has(p));
  if (extra.length) throw new ReleaseRefused(`release holds files the manifest does not list: ${extra.join(', ')}`);
  const have = new Set(copied);
  const missing = [...listed].filter((p) => !have.has(p));
  if (missing.length) throw new ReleaseRefused(`release lacks listed files: ${missing.join(', ')}`);
}

/** Sets every directory under `root`, and `root` itself, to `dirMode` and every file to `fileMode`. */
function setModes(root, dirMode, fileMode) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) setModes(p, dirMode, fileMode);
    else fs.chmodSync(p, fileMode);
  }
  fs.chmodSync(root, dirMode);
}

/**
 * Copies release `dir` into a new dir under `privateRoot`, checks the signature and every hash on the copy, and makes
 * the copy read-only. `expectedSha256` is the manifest hash the operator gave; `keys` the pinned key list.
 * Returns `{root, manifest, manifestSha256, keyId, fileOf(rel), sha256Of(rel)}`. Throws ReleaseRefused.
 */
function intakeRelease({ dir, expectedSha256, privateRoot, keys = PINNED_KEYS }) {
  const root = fs.mkdtempSync(path.join(privateRoot, 'release-'));
  try {
    return checkedCopy(dir, root, expectedSha256, keys);
  } catch (e) {
    discardRelease(root);
    throw e;
  }
}

/** The intake steps on `root`, a fresh dir that receives the copy of `dir`; see intakeRelease. */
function checkedCopy(dir, root, expectedSha256, keys) {
  const copied = copyTree(dir, root);
  const read = (rel) => fs.readFileSync(path.join(root, rel));
  if (!copied.includes(MANIFEST_FILE) || !copied.includes(SIGNATURE_FILE)) throw new ReleaseRefused(`release needs ${MANIFEST_FILE} and ${SIGNATURE_FILE}`);
  const checked = checkManifest({ manifestBytes: read(MANIFEST_FILE), signatureText: read(SIGNATURE_FILE).toString('utf8'), expectedSha256, keys });
  checkListedExactly(copied, checked.manifest);
  const hashes = new Map(checked.manifest.files.map((f) => [f.path, f.sha256]));
  for (const [rel, sha] of hashes) {
    if (sha256Hex(read(rel)) !== sha) throw new ReleaseRefused(`release file ${rel} does not match its manifest hash`);
  }
  setModes(root, 0o500, 0o400);
  return { ...checked, root, fileOf: (rel) => path.join(root, rel), sha256Of: (rel) => hashes.get(rel) ?? null };
}

/** Removes a release copy made by intakeRelease, first making it writable again. A missing copy is not an error. */
function discardRelease(root) {
  if (!fs.existsSync(root)) return;
  setModes(root, 0o700, 0o600);
  fs.rmSync(root, { recursive: true, force: true });
}

const isInside = (parent, p) => {
  const rel = path.relative(parent, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Throws ReleaseRefused when `p` (named `what`) lies inside any of `roots` (`{name: dir}`), compared by real path (SR-19). */
function refuseInside(what, p, roots) {
  const real = fs.realpathSync(p);
  for (const [name, dir] of Object.entries(roots)) {
    if (dir && isInside(fs.realpathSync(dir), real)) throw new ReleaseRefused(`${what} ${real} lies inside ${name} ${dir}; plant paths must sit outside scratch, home and the repo`);
  }
}

/** Throws ReleaseRefused unless the suite's arms are all plant arms, its tasks all plant tasks, and it runs one trial at a time. */
function checkSuiteShape({ arms, tasks, parallel }) {
  const other = arms.filter((a) => !a.plant).map((a) => a.id);
  if (other.length) throw new ReleaseRefused(`a plant suite runs plant arms only; also given: ${other.join(', ')}`);
  const notPlant = tasks.filter((t) => !t.environment).map((t) => t.id);
  if (notPlant.length) throw new ReleaseRefused(`plant arms run plant tasks only; ${notPlant.join(', ')} has no environment block`);
  if (parallel !== 1) throw new ReleaseRefused(`a plant suite runs one trial at a time (SR-23); --parallel ${parallel} is refused`);
}

/**
 * Throws ReleaseRefused when `kiroBin` is a launcher rather than the Kiro CLI binary: a launcher shim (a link to
 * the shared launcher executable, the same file for every tool it installs) or the `sandbox/kiro-cli` wrapper script. Hashing either would
 * pin the launcher, not the build that runs.
 */
function refuseLauncher(kiroBin) {
  const real = fs.realpathSync(kiroBin);
  const fix = 'pass the real binary with --kiro-bin, for example <launcher-dir>/tools/kiro-cli/<version>/kiro-cli';
  if (path.basename(real) === SHARED_LAUNCHER) throw new ReleaseRefused(`${kiroBin} is a launcher shim (it resolves to ${real}), not the Kiro CLI binary; ${fix}`);
  const sibling = path.join(path.dirname(real), '..', 'kiro-cli');
  if (path.basename(path.dirname(real)) === 'sandbox' && fs.existsSync(sibling)) {
    throw new ReleaseRefused(`${kiroBin} is the sandbox wrapper ${real}, not the Kiro CLI binary; pass --kiro-bin ${fs.realpathSync(sibling)}`);
  }
}

/**
 * Throws ReleaseRefused unless the Kiro CLI at `kiroBin` has the version and SHA-256 the manifest pins (NFR-11), and
 * `agentEngine` is the engine the release pins. A release pins one exact build, never a range.
 */
function checkKiroPin(kiroBin, manifest, versionOfBin, agentEngine) {
  const pin = manifest.versions?.kiroCli;
  if (!pin?.version || !pin?.sha256 || !AGENT_ENGINES.includes(pin?.engine)) {
    throw new ReleaseRefused(`manifest versions.kiroCli must name the Kiro CLI version, SHA-256 and engine (${AGENT_ENGINES.join(' or ')})`);
  }
  refuseLauncher(kiroBin);
  const sha = sha256File(fs.realpathSync(kiroBin));
  const version = versionOfBin(kiroBin);
  if (sha !== pin.sha256 || version !== pin.version) throw new ReleaseRefused(`Kiro CLI ${kiroBin} (${version}, ${sha}) is not the pinned ${pin.version} (${pin.sha256})`);
  if (agentEngine !== pin.engine) throw new ReleaseRefused(`the release pins agent engine ${pin.engine}; --agent-engine ${agentEngine} is refused`);
}

/**
 * True when the suite is counted. Without --kiro-bin it always is, and the Kiro CLI found on PATH must pass the pin.
 * With --kiro-bin it is counted only when that binary reports the pinned version (then it must pass the whole pin, so
 * a wrong build of that version is refused, not run as a control); any other --kiro-bin is a control.
 */
function isCountedSuite(opts, kiroBin, manifest, versionOfBin) {
  if (!opts['kiro-bin']) return true;
  const pinned = manifest.versions?.kiroCli?.version;
  if (!pinned) return false;
  refuseLauncher(kiroBin);
  return versionOfBin(kiroBin) === pinned;
}

/**
 * What kind of suite a Strands run is: `{control, notCounted}`. A scripted `fake:` model is a control. A real model is a
 * real suite; when the release pins no `versions.strands.version` it is not counted, and `notCounted` names why. Throws
 * ReleaseRefused when the pin and the interpreter's `strands.version` differ, so a wrong SDK is refused, not run.
 */
function strandsSuiteOf(manifest, strands, model) {
  if (String(model).startsWith('fake:')) return { control: true, notCounted: [] };
  const pinned = manifest.versions?.strands?.version;
  if (!pinned) return { control: false, notCounted: [NOT_COUNTED.noStrandsPin] };
  if (strands?.version !== pinned) throw new ReleaseRefused(`strands-agents ${strands?.version} is not the pinned ${pinned}`);
  return { control: false, notCounted: [] };
}

/** Throws ReleaseRefused when the out dir shares a filesystem with scratch or home (NFR-12, counted suites with isolation). */
function checkOutFilesystem(outDir, others) {
  const dev = fs.statSync(outDir).dev;
  for (const [name, dir] of Object.entries(others)) {
    if (fs.statSync(dir).dev === dev) throw new ReleaseRefused(`the out dir is on the same filesystem as ${name} ${dir}; a counted plant suite needs its own`);
  }
}

/**
 * Whether a plant suite is counted and comparable, and why not: `{counted, comparable, notCounted}`. A control suite is
 * neither, with no reason (it is a control). Any other suite is counted only in a comparable isolation mode on Linux and on
 * a quiet host; `noise` lists the host's listeners outside the allowlist (hostNoise), and `reasons` adds reasons of the suite's
 * own (strandsSuiteOf). `notCounted` holds the NOT_COUNTED
 * reasons. Comparable is the same as counted: a suite that is not counted is never comparable.
 */
function countingOf({ control, mode, platform = process.platform, noise = [], reasons = [] }) {
  if (control) return { counted: false, comparable: false, notCounted: [] };
  const notCounted = [
    ...reasons,
    ...(platform === 'linux' && isComparableMode(mode) ? [] : [NOT_COUNTED.noSandbox]),
    ...(noise.length ? [NOT_COUNTED.noisyHost] : []),
  ];
  return { counted: notCounted.length === 0, comparable: notCounted.length === 0, notCounted };
}

/**
 * Checks each plant task against the release copy and points its fixture at the copy. Returns `{fileOf(id), seedOf(id)}`.
 * A task must come from the release: its file `tasks/<id>.json` listed in the manifest, byte-equal to the file bench loaded
 * from --extra-tasks, its fixture under `tasks/fixtures/` and its seed in the manifest's `seeds`. Mutates `task.fixtureDir`.
 */
function bindTasks(tasks, release) {
  const files = new Map();
  for (const task of tasks) {
    readEnvironment(task.environment);
    const rel = `tasks/${task.id}.json`;
    const loaded = task.extraDir ? path.join(task.extraDir, `${task.id}.json`) : null;
    if (!release.sha256Of(rel) || !loaded || !fs.existsSync(loaded) || sha256File(loaded) !== release.sha256Of(rel)) {
      throw new ReleaseRefused(`plant task ${task.id} must be the release's ${rel}, loaded with --extra-tasks <release>/tasks`);
    }
    const fixture = release.fileOf(`tasks/fixtures/${task.fixture}`);
    if (!fs.existsSync(fixture)) throw new ReleaseRefused(`plant task ${task.id}: fixture tasks/fixtures/${task.fixture} is not in the release`);
    if (!Number.isInteger(release.manifest.seeds?.[task.id])) throw new ReleaseRefused(`plant task ${task.id} has no integer seed in the manifest`);
    task.fixtureDir = fixture;
    files.set(task.id, release.fileOf(rel));
  }
  return { fileOf: (id) => files.get(id), seedOf: (id) => release.manifest.seeds[id] };
}

/** `{absolute path: sha256}` for the policy files the release holds, which hello passes to the gateway. */
function gatewayFilesOf(release) {
  return Object.fromEntries(POLICY_FILES.filter((rel) => release.sha256Of(rel)).map((rel) => [release.fileOf(rel), release.sha256Of(rel)]));
}

/**
 * `{control, notCounted}` for the suite: a Strands suite by its model (strandsSuiteOf), a Kiro CLI suite by its
 * `--kiro-bin` (isCountedSuite). `strands` is true when the suite's arms run Strands; the rest are preparePlantSuite's.
 */
function suiteKindOf({ strands, opts, ctx, manifest, versionOfBin }) {
  if (strands) return strandsSuiteOf(manifest, ctx.strands, ctx.config.model);
  return { control: !isCountedSuite(opts, ctx.kiroBin, manifest, versionOfBin), notCounted: [] };
}

/**
 * The checks only a real (not control) suite gets, before any trial: the Kiro CLI pin (Kiro CLI suites), the Cedar
 * files, the quiet host and, in a sandbox mode, an out dir on its own filesystem. Returns the host's listeners outside
 * the allowlist (empty on a quiet host). Throws ReleaseRefused. Arguments are preparePlantSuite's.
 */
function checkRealSuite({ release, ctx, strands, outDir, home, versionOfBin, noiseOf }) {
  if (!strands) checkKiroPin(ctx.kiroBin, release.manifest, versionOfBin, ctx.config.agentEngine);
  const missing = POLICY_FILES.filter((rel) => !release.sha256Of(rel));
  if (missing.length) throw new ReleaseRefused(`a counted plant suite needs the Cedar files; the release lacks ${missing.join(', ')}`);
  const comparableMode = isComparableMode(ctx.isolation.mode);
  // Quiet-host check (13.5 B-6): a sandboxed suite on a noisy host is refused, as the prober would refuse it; an
  // unsandboxed pilot is never counted anyway, so it runs and the report header says the host was noisy too (question 20).
  const noise = noiseOf(release);
  if (noise.length && comparableMode) throw new ReleaseRefused(`a counted plant suite needs a quiet host; listeners outside the release allowlist: ${noise.join(', ')} (13.5)`);
  // The own-filesystem rule guards a counted suite. A suite run with --isolate none --allow-unisolated is never counted
  // and the report warns on it, so it may write its out dir anywhere outside scratch, home and the repo (the pilot).
  if (comparableMode) checkOutFilesystem(outDir, { scratch: ctx.scratchDir, home });
  return noise;
}

/**
 * The preflight of a plant suite (7.1). Returns the suite context the runs use, or throws ReleaseRefused.
 *
 * `opts` holds the run flags (--plant-release, --plant-release-sha256, --plant-python, --kiro-bin); `arms`, `tasks` and
 * `parallel` are the resolved run; `outDir` the run's out dir; `ctx` the run context (scratchDir, kiroBin, config,
 * isolation); `repo` the repository root. A suite with --kiro-bin is a control suite (`control: true`): no Kiro CLI pin, no
 * Cedar files, no out-dir filesystem check and no quiet-host check, unless that binary reports the pinned version (see
 * isCountedSuite). `counted`, `comparable` and `notCounted` come from countingOf. Seams: `keys` (pinned keys),
 * `privateParent` (where the runner-private dir is made; default TMPDIR, or /tmp when TMPDIR is inside home), `home`, `versionOfBin`, `deadlines`, `makeToken`,
 * `readListeners` and `noiseOf(release)` (the quiet-host check, default hostNoise).
 */
function preparePlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo, keys = PINNED_KEYS, privateParent = null, home = os.homedir(), versionOfBin = versionOf, deadlines = DEADLINES, makeToken, readListeners, noiseOf = hostNoise }) {
  checkSuiteShape({ arms, tasks, parallel });
  const dir = opts['plant-release'];
  const expectedSha256 = opts['plant-release-sha256'];
  if (!dir || dir === true || !fs.existsSync(dir)) throw new ReleaseRefused('plant arms need --plant-release DIR (an unpacked release)');
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha256))) throw new ReleaseRefused('plant arms need --plant-release-sha256 HEX (64 lowercase hex characters)');
  const roots = { scratch: ctx.scratchDir, home, repo };
  refuseInside('the plant release', dir, roots);
  refuseInside('the out dir', outDir, roots);
  // Default: TMPDIR, or /tmp when TMPDIR is inside home (a session scratch dir), which refuseInside below would refuse.
  const privateRoot = fs.mkdtempSync(path.join(privateParent ?? tmpOutsideHome(realHomes(home)), 'kplant-'));
  procs.trackScratch(privateRoot); // a SIGINT or SIGTERM removes it too (D-93), read-only release copy included
  let release = null;
  try {
    refuseInside('the runner-private dir', privateRoot, roots);
    const socketParent = path.join(privateRoot, 'sock');
    fs.mkdirSync(socketParent, { mode: 0o700 });
    if (Buffer.byteLength(socketParent) + SOCKET_SUFFIX_BYTES > SOCKET_PATH_MAX) throw new ReleaseRefused(`socket paths under ${socketParent} would pass ${SOCKET_PATH_MAX} bytes`);
    release = intakeRelease({ dir, expectedSha256, privateRoot, keys });
    const strands = arms[0].runtime === 'strands';
    const kind = suiteKindOf({ strands, opts, ctx, manifest: release.manifest, versionOfBin });
    const { control } = kind;
    const noise = control ? [] : checkRealSuite({ release, ctx, strands, outDir, home, versionOfBin, noiseOf });
    if (!release.sha256Of(REFUSAL_RULE)) throw new ReleaseRefused(`the release lacks ${REFUSAL_RULE}`);
    return {
      release, privateRoot, socketParent, control, hostNoise: noise, deadlines, makeToken, readListeners,
      ...countingOf({ control, mode: ctx.isolation.mode, noise, reasons: kind.notCounted }),
      python: opts['plant-python'] && opts['plant-python'] !== true ? opts['plant-python'] : 'python3',
      isolationMode: ctx.isolation.mode,
      tasks: bindTasks(tasks, release),
      gatewayFiles: gatewayFilesOf(release),
      policySha256: release.sha256Of(POLICY_FILES[0]),
      refusalRule: loadRefusalRule(release.fileOf(REFUSAL_RULE)),
      mask: [release.root],
      dispose: () => removePrivateRoot(privateRoot, release.root),
    };
  } catch (e) {
    removePrivateRoot(privateRoot, release?.root);
    throw e;
  }
}

/** Removes the runner-private dir, with the release copy `releaseRoot` inside it when there is one. */
function removePrivateRoot(privateRoot, releaseRoot) {
  if (releaseRoot) discardRelease(releaseRoot);
  fs.rmSync(privateRoot, { recursive: true, force: true });
  procs.untrackScratch(privateRoot);
}

module.exports = { SOCKET_PATH_MAX, checkSuiteShape, oddFileReason, refuseLauncher, strandsSuiteOf, intakeRelease, discardRelease, preparePlantSuite, countingOf, refuseInside, setModes, ReleaseRefused };
