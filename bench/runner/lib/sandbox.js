// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { buildCheckEnv, buildBuildEnv } = require('./env.js');
const { ANSWER_KEY } = require('./check-matcher.js');
const armSource = require('./arm-source.js');
const { kiroInstallHarness } = require('./harness/runtime.js');
const { realHomes } = require('./isolate.js');
const { tryMark } = require('./owned.js');
const { assertPlainPath } = require('./safe-copy.js');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-15).join('\n');
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status}):\n${tail}`);
  }
  return r;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Neutral name: the agent sees this path in its prompts, env and tool output.
function makeScratchRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  tryMark(dir, 'scratch');
  return dir;
}

// Writes the tree of `sha` into dir. The working tree and index are never read.
function exportRef(repo, sha, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const archive = spawnSync('git', ['-C', repo, 'archive', sha], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive ${sha} failed: ${archive.stderr}`);
  run('tar', ['-x', '-C', dir], { input: archive.stdout, encoding: null });
}

// Writes an arm's source into dir: `git archive` of its commit, or a snapshot of its working-tree directory.
function exportArm(arm, ctx, dir) {
  if (arm.source === 'dir') {
    fs.mkdirSync(dir, { recursive: true });
    armSource.copySnapshot(arm.dir, dir, arm.contentHash);
  } else {
    exportRef(ctx.repo, arm.commitSha, dir);
  }
}

// What each build step reads from the export; a ref without these predates the layout the runner builds from.
const KIRO_REQUIRED = ['cli/konductor-rs/Cargo.toml', 'mcp/Cargo.toml'];

// cargo on an arbitrary ref: allowlisted environment, scratch HOME removed afterwards. Residual risk: build.rs still runs as the
// invoking user and can read files that user can read (the real CARGO_HOME holds registry credentials when any are configured).
// Containing that needs the namespace or sandbox the agent runs in, which the build does not use.
function cargoBuild(args, { targetDir, ctx }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    fs.mkdirSync(path.join(home, 'tmp'));
    const { env, refused } = buildBuildEnv(process.env, { home, cargoTarget: targetDir, online: Boolean(ctx.cargoOnline) });
    if (refused.length) throw new Error(`BENCH_BUILD_ENV_KEEP names look like credentials and are refused: ${refused.join(', ')}`);
    return run('cargo', args, { env });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Builds skill-lookup-mcp from the arm's own export so each arm ships the server of its own release.
function buildMcp(exportDir, ctx) {
  const manifest = path.join(exportDir, 'mcp/Cargo.toml');
  if (!fs.existsSync(manifest)) throw new Error('this ref has no mcp/Cargo.toml');
  const args = ['build', '--release', '--workspace', '--manifest-path', manifest];
  if (!ctx.cargoOnline) args.push('--offline');
  try {
    cargoBuild(args, { targetDir: `${ctx.cargoTarget}-mcp`, ctx });
  } catch (e) {
    const hint = ctx.cargoOnline ? '' : ' (offline build; pre-fetch the crates or pass --cargo-online)';
    throw new Error(`skill-lookup-mcp build failed${hint}: ${e.message}`);
  }
  const built = path.join(`${ctx.cargoTarget}-mcp`, 'release/skill-lookup-mcp');
  const dest = path.join(exportDir, 'mcp/target/release/skill-lookup-mcp');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(built, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

// Builds the konductor CLI of an exported ref and copies it to `bin`.
function buildCli(exportDir, bin, ctx) {
  const manifest = path.join(exportDir, 'cli/konductor-rs/Cargo.toml');
  if (!fs.existsSync(manifest)) throw new Error('this ref has no cli/konductor-rs/Cargo.toml (it predates the layout the benchmark builds from)');
  const cargoArgs = ['build', '--release', '--manifest-path', manifest];
  if (!ctx.cargoOnline) cargoArgs.push('--offline');
  cargoBuild(cargoArgs, { targetDir: ctx.cargoTarget, ctx });
  fs.copyFileSync(path.join(ctx.cargoTarget, 'release/konductor'), bin);
  fs.chmodSync(bin, 0o755);
}

function readyMatches(ready, arm) {
  return arm.source === 'dir' ? ready.contentHash === arm.contentHash : ready.commitSha === arm.commitSha;
}

// The konductor CLI logs each call and records every install under $HOME/.konductor, so it only
// ever runs with a scratch HOME and the allowlisted environment, never the invoking user's home.
function runKonductor(bin, args, { home, cwd } = {}) {
  if (!home) throw new Error(`konductor ${args[0]} needs a scratch HOME`);
  fs.mkdirSync(home, { recursive: true });
  if (realHomes().includes(fs.realpathSync(home))) throw new Error(`konductor ${args[0]} refused to run with the real HOME ${home}`);
  const { env } = buildCheckEnv(process.env, { home });
  return run(bin, args, { cwd, env });
}

// The arm's own binary logs each call under $HOME, so synth gets a throwaway HOME instead of the invoking user's.
function synthArm(bin, exportDir) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  try {
    runKonductor(bin, ['synth', '--from', exportDir], { home, cwd: exportDir });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

let toolchainCache = null;
// The compiler versions are build inputs: a toolchain upgrade between commands must not reuse a binary built by the old one.
const toolchainId = () => (toolchainCache ??= `${versionOf('rustc') ?? 'rustc?'}|${versionOf('cargo') ?? 'cargo?'}`);

/**
 * The cache directory of an arm's build of `kind` (kiro, claude, opencode). It is keyed by what the build reads: the
 * arm's commit or snapshot hash (its cacheKey, which a variant extends) and the toolchain, never by the arm's name, so
 * two arms on the same content share one build and one binary.
 */
function buildDirOf(ctx, kind, arm) {
  const source = arm.cacheKey ?? arm.commitSha.slice(0, 12);
  const inputs = crypto.createHash('sha256').update(JSON.stringify({ kind, source, commitSha: arm.commitSha ?? null, contentHash: arm.contentHash ?? null, toolchain: ctx.toolchainId ?? toolchainId() })).digest('hex').slice(0, 10);
  return path.join(ctx.cacheDir, `${kind}-${source}-${inputs}`);
}

/**
 * Exports the arm (commit or working-tree snapshot), builds its MCP server and CLI, and synthesizes dist/.
 * Cached in buildDirOf (by commit SHA, or content hash for a directory arm, plus the toolchain; shared by arms of any name); a cache hit is reused only if the MCP
 * binary still matches the sha256 recorded when it was built.
 */
function prepareArm(arm, ctx) {
  const dir = buildDirOf(ctx, 'kiro', arm);
  const exportDir = path.join(dir, 'src');
  const bin = path.join(dir, 'konductor');
  const mcpBin = path.join(exportDir, 'mcp/target/release/skill-lookup-mcp');
  const readyFile = path.join(dir, '.ready');
  if (fs.existsSync(readyFile)) {
    try {
      const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      if (readyMatches(ready, arm) && fs.existsSync(mcpBin) && sha256File(mcpBin) === ready.mcpSha256) {
        return { exportDir, bin, mcpBin, mcpSha256: ready.mcpSha256, cached: true };
      }
    } catch { /* rebuild */ }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  exportArm(arm, ctx, exportDir);
  buildMcp(exportDir, ctx);

  buildCli(exportDir, bin, ctx);
  synthArm(bin, exportDir);
  const mcpSha256 = sha256File(mcpBin);
  fs.writeFileSync(readyFile, JSON.stringify({ commitSha: arm.commitSha, contentHash: arm.contentHash ?? null, mcpSha256 }) + '\n');
  return { exportDir, bin, mcpBin, mcpSha256, cached: false };
}

// Agent JSON embeds absolute install paths, so each run installs into its own HOME.
function installInto(home, prepared, agentEngine) {
  return runKonductor(prepared.bin, ['install', '--harness', kiroInstallHarness(agentEngine), '--from', prepared.exportDir, '--no-telemetry'], { home }).stdout.trim();
}

// Old releases pin older models in their agent specs. Rewrites `model` in every installed
// agent so subagents run on the benchmark model. Returns the agents that changed.
function normalizeAgentModels(home, model) {
  const dir = path.join(home, '.kiro/agents');
  const rewritten = [];
  if (!fs.existsSync(dir)) return rewritten;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, f);
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (spec.model === model) continue;
    spec.model = model;
    fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
    rewritten.push(f.replace(/\.json$/, ''));
  }
  return rewritten;
}

function emptyKiroHome(home) {
  for (const d of ['agents', 'steering', 'skills', 'memories']) {
    fs.mkdirSync(path.join(home, '.kiro', d), { recursive: true });
  }
}

// kiro-cli keeps its data under ~/Library/Application Support on macOS and ~/.local/share elsewhere.
function kiroDataDir(home, platform = process.platform) {
  return path.join(home, platform === 'darwin' ? 'Library/Application Support/kiro-cli' : '.local/share/kiro-cli');
}

function copyAuthDb(src, home, platform = process.platform) {
  const destDir = kiroDataDir(home, platform);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'data.sqlite3');
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
  return dest;
}

function removeAuthCopy(home, platform = process.platform) {
  const dir = kiroDataDir(home, platform);
  // The agent can swap a folder of its HOME for a link to the real user's data directory; never delete through one.
  try { assertPlainPath(home, path.relative(home, dir), { last: 'dir' }); } catch { return; }
  fs.rmSync(path.join(dir, 'data.sqlite3'), { force: true });
}

// The answer key is judge-only; the agent must never find it in its working directory.
// A fixture directory `dotgit/` is the fixture's own git repository: git cannot store a .git directory, so the copy renames it.
function copyFixture(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => path.basename(p) !== ANSWER_KEY });
  const dotgit = path.join(dest, 'dotgit');
  if (fs.existsSync(dotgit)) {
    fs.renameSync(dotgit, path.join(dest, '.git'));
    // git stores no empty directory, so a fresh checkout of the bench has a dotgit/ with no refs/, and git then says
    // "not a git repository" (t11-merge-pricing-branches); git needs refs/heads and refs/tags to exist.
    for (const d of ['refs/heads', 'refs/tags']) fs.mkdirSync(path.join(dest, '.git', d), { recursive: true });
  }
}

function findAnswerKey(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ANSWER_KEY) return path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
      const hit = findAnswerKey(path.join(dir, e.name));
      if (hit) return hit;
    }
  }
  return null;
}

function defaultAuthDb(home = os.homedir(), platform = process.platform) {
  return path.join(kiroDataDir(home, platform), 'data.sqlite3');
}

function versionOf(cmd, args = ['--version']) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

/** The `--version` line of the kiro-cli at `bin` (default: the one on PATH). */
const kiroCliVersion = (bin = 'kiro-cli') => versionOf(bin);

// A launcher shim: <launcher-dir>/bin/<tool> links to one launcher executable shared by every tool it installs, which
// picks the tool's current version and runs that version's executable. The launcher can refuse to run under the bench.
// SHARED_LAUNCHER is that executable's file name.
const SHARED_LAUNCHER = 'toolbox-exec';
const NATIVE_MAGIC = ['7f454c46', 'cffaedfe', 'cefaedfe', 'cafebabe'];

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** True when `file` starts with an ELF or Mach-O header, so it is a native binary and not a launcher script. */
function isNativeBinary(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && NATIVE_MAGIC.includes(b.toString('hex'));
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/**
 * The executable a launcher shim at `candidate` would run, from the launcher's records of the tool:
 * <launcher-dir>/tools/<name>/info.json names the current version and tools/<name>/<version>.json its executable.
 * Null when the layout is not there.
 */
function launcherExecutable(candidate, name = 'kiro-cli') {
  const roots = [path.dirname(path.dirname(candidate))];
  try { roots.push(path.dirname(path.dirname(path.dirname(path.dirname(fs.realpathSync(candidate)))))); } catch { /* not resolvable */ }
  for (const root of roots) {
    const toolDir = path.join(root, 'tools', name);
    const version = readJsonFile(path.join(toolDir, 'info.json'))?.CurrentVersion?.Version;
    if (typeof version !== 'string' || !/^[\w.+-]+$/.test(version)) continue;
    const bundle = readJsonFile(path.join(toolDir, `${version}.json`))?.Executables?.[name]?.BundlePath;
    if (typeof bundle !== 'string' || path.isAbsolute(bundle) || bundle.split('/').includes('..')) continue;
    const exe = path.join(toolDir, version, bundle);
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

/**
 * The kiro-cli a run uses, from PATH. Two known launchers are unwrapped to the native binary they start: a launcher
 * shim (a link to the shared launcher executable) and the `sandbox/kiro-cli` wrapper script, which routes through a sandboxing launcher
 * that depends on the invoking user's environment and can attach extra tools. When a known launcher does not lead
 * to a native binary, this throws and names --kiro-bin. Any other kiro-cli is used as found.
 */
function resolveKiroCli(pathEnv = process.env.PATH) {
  for (const dir of (pathEnv || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'kiro-cli');
    let real;
    try { real = fs.realpathSync(candidate); fs.accessSync(real, fs.constants.X_OK); } catch { continue; }
    const shims = [];
    if (path.basename(real) === SHARED_LAUNCHER) {
      const exe = launcherExecutable(candidate);
      if (!exe) throw new Error(`${candidate} is a launcher shim (it resolves to ${real}) and the kiro-cli it starts could not be found from the launcher's records; pass the native kiro-cli binary with --kiro-bin PATH`);
      shims.push(real);
      real = fs.realpathSync(exe);
    }
    const sibling = path.join(path.dirname(real), '..', 'kiro-cli');
    if (path.basename(path.dirname(real)) === 'sandbox' && fs.existsSync(sibling)) {
      shims.push(real);
      real = fs.realpathSync(sibling);
    }
    if (!shims.length) return { bin: real, shim: null };
    if (!isNativeBinary(real)) throw new Error(`${candidate} is a launcher (${shims.join(' -> ')}) and ${real} is not a native binary either; pass the native kiro-cli binary with --kiro-bin PATH`);
    return { bin: real, shim: shims.join(' -> ') };
  }
  throw new Error('kiro-cli not found on PATH; pass the kiro-cli binary with --kiro-bin PATH');
}

module.exports = {
  prepareArm, synthArm, installInto, runKonductor, normalizeAgentModels, emptyKiroHome, kiroDataDir, copyAuthDb, removeAuthCopy, copyFixture, findAnswerKey,
  exportRef, exportArm, readyMatches, buildDirOf, KIRO_REQUIRED, buildMcp, buildCli, sha256File, resolveKiroCli, isNativeBinary, launcherExecutable, SHARED_LAUNCHER, makeScratchRoot, defaultAuthDb, kiroCliVersion, versionOf, run, ANSWER_KEY,
};
