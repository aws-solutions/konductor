// SPDX-License-Identifier: Apache-2.0
'use strict';

// Plant suite intake (7.1, SR-15, SR-19, SR-23, NFR-11): copies the release into a runner-private dir, checks it
// there, and refuses a suite whose paths, parallelism or Kiro CLI pin are wrong. Never reads the original dir again,
// never follows a link and never keeps a file the manifest does not list.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyPlainFile } = require('../safe-copy.js');
const { sha256File, versionOf } = require('../sandbox.js');
const { isComparableMode } = require('../isolate.js');
const { checkManifest, sha256Hex, ReleaseRefused, PINNED_KEYS, MANIFEST_FILE, SIGNATURE_FILE } = require('./manifest.js');
const { DEADLINES } = require('./gateway-proc.js');
const { loadRefusalRule } = require('./refusal.js');
const { readEnvironment } = require('./score.js');
const { AGENT_ENGINES } = require('../harness/runtime.js');

const POLICY_FILES = ['policy/plant.cedar', 'policy/plant.cedarschema', 'sensor-limits.json'];
const REFUSAL_RULE = 'refusal-rule.json';
const SOCKET_PATH_MAX = 107;
// What a toolbox shim on PATH (for example ~/.toolbox/bin/kiro-cli) resolves to.
const TOOLBOX_EXEC = 'toolbox-exec';
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
 * Throws ReleaseRefused when `kiroBin` is a launcher rather than the Kiro CLI binary: a toolbox shim (a link to
 * `toolbox-exec`, the same file for every toolbox tool) or the `sandbox/kiro-cli` wrapper script. Hashing either would
 * pin the launcher, not the build that runs.
 */
function refuseLauncher(kiroBin) {
  const real = fs.realpathSync(kiroBin);
  const fix = 'pass the real binary with --kiro-bin, for example ~/.toolbox/tools/kiro-cli/<version>/kiro-cli';
  if (path.basename(real) === TOOLBOX_EXEC) throw new ReleaseRefused(`${kiroBin} is a toolbox shim (it resolves to ${real}), not the Kiro CLI binary; ${fix}`);
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

/** Throws ReleaseRefused when the out dir shares a filesystem with scratch or home (NFR-12, counted suites with isolation). */
function checkOutFilesystem(outDir, others) {
  const dev = fs.statSync(outDir).dev;
  for (const [name, dir] of Object.entries(others)) {
    if (fs.statSync(dir).dev === dev) throw new ReleaseRefused(`the out dir is on the same filesystem as ${name} ${dir}; a counted plant suite needs its own`);
  }
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
 * The preflight of a plant suite (7.1). Returns the suite context the runs use, or throws ReleaseRefused.
 *
 * `opts` holds the run flags (--plant-release, --plant-release-sha256, --plant-python, --kiro-bin); `arms`, `tasks` and
 * `parallel` are the resolved run; `outDir` the run's out dir; `ctx` the run context (scratchDir, kiroBin, config,
 * isolation); `repo` the repository root. A suite with --kiro-bin is a control suite: no Kiro CLI pin, no Cedar files and
 * no out-dir filesystem check, and its trials are never comparable, unless that binary reports the pinned version
 * (see isCountedSuite). Seams: `keys` (pinned keys), `privateParent` (where
 * the runner-private dir is made), `home`, `versionOfBin`, `deadlines`, `makeToken` and `readListeners`.
 */
function preparePlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo, keys = PINNED_KEYS, privateParent = os.tmpdir(), home = os.homedir(), versionOfBin = versionOf, deadlines = DEADLINES, makeToken, readListeners }) {
  checkSuiteShape({ arms, tasks, parallel });
  const dir = opts['plant-release'];
  const expectedSha256 = opts['plant-release-sha256'];
  if (!dir || dir === true || !fs.existsSync(dir)) throw new ReleaseRefused('plant arms need --plant-release DIR (an unpacked release)');
  if (!/^[0-9a-f]{64}$/.test(String(expectedSha256))) throw new ReleaseRefused('plant arms need --plant-release-sha256 HEX (64 lowercase hex characters)');
  const roots = { scratch: ctx.scratchDir, home, repo };
  refuseInside('the plant release', dir, roots);
  refuseInside('the out dir', outDir, roots);
  const privateRoot = fs.mkdtempSync(path.join(privateParent, 'kplant-'));
  let release = null;
  try {
    refuseInside('the runner-private dir', privateRoot, roots);
    const socketParent = path.join(privateRoot, 'sock');
    fs.mkdirSync(socketParent, { mode: 0o700 });
    if (Buffer.byteLength(socketParent) + SOCKET_SUFFIX_BYTES > SOCKET_PATH_MAX) throw new ReleaseRefused(`socket paths under ${socketParent} would pass ${SOCKET_PATH_MAX} bytes`);
    release = intakeRelease({ dir, expectedSha256, privateRoot, keys });
    const counted = isCountedSuite(opts, ctx.kiroBin, release.manifest, versionOfBin);
    if (counted) {
      checkKiroPin(ctx.kiroBin, release.manifest, versionOfBin, ctx.config.agentEngine);
      const missing = POLICY_FILES.filter((rel) => !release.sha256Of(rel));
      if (missing.length) throw new ReleaseRefused(`a counted plant suite needs the Cedar files; the release lacks ${missing.join(', ')}`);
      // The own-filesystem rule guards a comparable suite. A suite run with --isolate none --allow-unisolated is never comparable
      // and the report warns on it, so it may write its out dir anywhere outside scratch, home and the repo (the pilot).
      if (isComparableMode(ctx.isolation.mode)) checkOutFilesystem(outDir, { scratch: ctx.scratchDir, home });
    }
    if (!release.sha256Of(REFUSAL_RULE)) throw new ReleaseRefused(`the release lacks ${REFUSAL_RULE}`);
    return {
      release, privateRoot, socketParent, counted, deadlines, makeToken, readListeners,
      comparable: counted && process.platform === 'linux' && isComparableMode(ctx.isolation.mode),
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
}

module.exports = { oddFileReason, refuseLauncher, intakeRelease, discardRelease, preparePlantSuite, refuseInside, setModes, ReleaseRefused };
