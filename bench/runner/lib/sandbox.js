// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { buildCheckEnv } = require('./env.js');
const { ANSWER_KEY } = require('./check-matcher.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
}

// Writes the tree of `sha` into dir. The working tree and index are never read.
function exportRef(repo, sha, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const archive = spawnSync('git', ['-C', repo, 'archive', sha], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive ${sha} failed: ${archive.stderr}`);
  run('tar', ['-x', '-C', dir], { input: archive.stdout, encoding: null });
}

// Builds skill-lookup-mcp from the arm's own export so each arm ships the server of its own release.
function buildMcp(exportDir, ctx) {
  const manifest = path.join(exportDir, 'mcp/Cargo.toml');
  if (!fs.existsSync(manifest)) throw new Error('this ref has no mcp/Cargo.toml');
  const args = ['build', '--release', '--workspace', '--manifest-path', manifest];
  if (!ctx.cargoOnline) args.push('--offline');
  try {
    run('cargo', args, { env: { ...process.env, CARGO_TARGET_DIR: `${ctx.cargoTarget}-mcp` } });
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
  const cargoArgs = ['build', '--release', '--manifest-path', path.join(exportDir, 'cli/konductor-rs/Cargo.toml')];
  if (!ctx.cargoOnline) cargoArgs.push('--offline');
  run('cargo', cargoArgs, { env: { ...process.env, CARGO_TARGET_DIR: ctx.cargoTarget } });
  fs.copyFileSync(path.join(ctx.cargoTarget, 'release/konductor'), bin);
  fs.chmodSync(bin, 0o755);
}

/**
 * Exports `arm.commitSha`, builds that commit's MCP server and CLI, and synthesizes dist/.
 * Cached by commit SHA; a cache hit is reused only if the MCP binary still matches the
 * sha256 recorded when it was built.
 */
function prepareArm(arm, ctx) {
  const dir = path.join(ctx.cacheDir, `${arm.id}-${arm.commitSha.slice(0, 12)}`);
  const exportDir = path.join(dir, 'src');
  const bin = path.join(dir, 'konductor');
  const mcpBin = path.join(exportDir, 'mcp/target/release/skill-lookup-mcp');
  const readyFile = path.join(dir, '.ready');
  if (fs.existsSync(readyFile)) {
    try {
      const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      if (ready.commitSha === arm.commitSha && fs.existsSync(mcpBin) && sha256File(mcpBin) === ready.mcpSha256) {
        return { exportDir, bin, mcpBin, mcpSha256: ready.mcpSha256, cached: true };
      }
    } catch { /* rebuild */ }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  exportRef(ctx.repo, arm.commitSha, exportDir);
  buildMcp(exportDir, ctx);

  buildCli(exportDir, bin, ctx);
  run(bin, ['synth', '--from', exportDir], { cwd: exportDir });
  const mcpSha256 = sha256File(mcpBin);
  fs.writeFileSync(readyFile, JSON.stringify({ commitSha: arm.commitSha, mcpSha256 }) + '\n');
  return { exportDir, bin, mcpBin, mcpSha256, cached: false };
}

// Agent JSON embeds absolute install paths, so each run installs into its own HOME.
function installInto(home, prepared) {
  fs.mkdirSync(home, { recursive: true });
  const { env } = buildCheckEnv(process.env, { home });
  return run(prepared.bin, ['install', '--harness', 'kiro-cli-v2', '--from', prepared.exportDir, '--no-telemetry'], { env }).stdout.trim();
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

function copyAuthDb(src, home) {
  const destDir = path.join(home, '.local/share/kiro-cli');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, 'data.sqlite3');
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o600);
  return dest;
}

function removeAuthCopy(home) {
  fs.rmSync(path.join(home, '.local/share/kiro-cli/data.sqlite3'), { force: true });
}

// The answer key is judge-only; the agent must never find it in its working directory.
function copyFixture(src, dest) {
  fs.cpSync(src, dest, { recursive: true, filter: (p) => path.basename(p) !== ANSWER_KEY });
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

function defaultAuthDb() {
  return path.join(os.homedir(), '.local/share/kiro-cli/data.sqlite3');
}

function versionOf(cmd, args = ['--version']) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
  } catch {
    return null;
  }
}

const kiroCliVersion = () => versionOf('kiro-cli');

// Some installs put a wrapper named kiro-cli on PATH (in a directory called "sandbox") that routes through
// a sandboxing launcher. That launcher depends on the invoking user's environment and can attach extra
// tools, so runs call the real binary next to the wrapper instead. Any other kiro-cli is used as found.
function resolveKiroCli(pathEnv = process.env.PATH) {
  for (const dir of (pathEnv || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'kiro-cli');
    let real;
    try { real = fs.realpathSync(candidate); fs.accessSync(real, fs.constants.X_OK); } catch { continue; }
    const sibling = path.join(path.dirname(real), '..', 'kiro-cli');
    if (path.basename(path.dirname(real)) === 'sandbox' && fs.existsSync(sibling)) {
      return { bin: fs.realpathSync(sibling), shim: real };
    }
    return { bin: real, shim: null };
  }
  throw new Error('kiro-cli not found on PATH');
}

module.exports = {
  prepareArm, installInto, normalizeAgentModels, emptyKiroHome, copyAuthDb, removeAuthCopy, copyFixture, findAnswerKey,
  exportRef, buildMcp, buildCli, sha256File, resolveKiroCli, makeScratchRoot, defaultAuthDb, kiroCliVersion, versionOf, run, ANSWER_KEY,
};
