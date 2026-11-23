// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code binary a run uses: the real `claude` (never a launcher script), or one of bench's plant controls, and
// the check that one study keeps one binary. Split out of claude-code.js (DEBT D-192).

const fs = require('node:fs');
const path = require('node:path');
const sandbox = require('../sandbox.js');

// The Claude Code version the stream parser and the harness flags were checked against.
const VALIDATED_VERSION = '2.1.316.1544';

// The real binary is a few hundred MB; a launcher script is a few KB.
const MIN_BINARY_BYTES = 50 * 1024 * 1024;

// ---- Binary ----

const versionKey = (v) => v.split('.').map((n) => Number(n) || 0);
function compareVersions(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** Why `bin` is not the claude binary, or null when it looks like it: the resolved file is named `claude` and is large. */
function launcherProblem(bin, minBytes) {
  let real = bin;
  try { real = fs.realpathSync(bin); } catch { /* judged by the given path */ }
  if (path.basename(real) !== 'claude') return `its file name is ${path.basename(real)}, not claude`;
  let size = 0;
  try { size = fs.statSync(real).size; } catch { /* reported as too small */ }
  if (size < minBytes) return `it is ${size} bytes, far smaller than the real binary`;
  return null;
}

const executable = (file) => { try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; } };

/** Whether the file contains the bytes of `needle`. Reads in chunks; the Claude Code binary is a few hundred MB. */
function binaryContains(file, needle) {
  const want = Buffer.from(needle);
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  let tail = Buffer.alloc(0);
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return false; }
  try {
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) return false;
      const hay = Buffer.concat([tail, chunk.subarray(0, n)]);
      if (hay.includes(want)) return true;
      tail = hay.subarray(Math.max(0, hay.length - (want.length - 1)));
    }
  } finally { fs.closeSync(fd); }
}

const PLANT_CONTROLS_DIR = path.resolve(__dirname, '..', '..', '..', 'physical', 'controls');
const PLANT_CONTROL_VERSION = 'plant-control';

/** Whether `bin` is one of bench's own Claude Code plant controls: named `<control>-claude`, its file in physical/controls. */
function isPlantControl(bin) {
  if (!/-claude$/.test(path.basename(bin))) return false;
  try { return path.dirname(fs.realpathSync(bin)) === fs.realpathSync(PLANT_CONTROLS_DIR); } catch { return false; }
}

/**
 * The claude binary a run uses: `binOverride` (or BENCH_CLAUDE_BIN), else the newest `<version>/claude` under `toolsDir`
 * (or BENCH_CLAUDE_TOOLS_DIR). There is no default location. A launcher script is refused.
 */
function resolveClaude({ binOverride = process.env.BENCH_CLAUDE_BIN || null, toolsDir = process.env.BENCH_CLAUDE_TOOLS_DIR || null, minBytes = MIN_BINARY_BYTES } = {}) {
  let bin = binOverride ? path.resolve(binOverride) : null;
  let version = null;
  if (!bin) {
    if (!toolsDir) throw new Error('no claude binary given; pass --claude-bin PATH or --claude-tools-dir DIR (BENCH_CLAUDE_BIN, BENCH_CLAUDE_TOOLS_DIR)');
    let versions = [];
    try {
      versions = fs.readdirSync(toolsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d+(\.\d+)+$/.test(e.name) && executable(path.join(toolsDir, e.name, 'claude')))
        .map((e) => e.name);
    } catch { /* reported below */ }
    if (!versions.length) throw new Error(`no claude binary found under ${toolsDir} (expected <version>/claude); pass --claude-bin PATH`);
    version = versions.sort(compareVersions).at(-1);
    bin = path.join(toolsDir, version, 'claude');
  }
  if (!executable(bin)) throw new Error(`claude binary is not executable: ${bin}`);
  // A bench plant control (`<control>-claude`, D-113) is a small script by design. It calls no model and reads no model
  // flag, so the launcher check does not apply and --effort is moot; its version pins nothing, so its suite is a control.
  if (isPlantControl(bin)) return { bin, version: PLANT_CONTROL_VERSION, sha256: sandbox.sha256File(bin), supportsHookEvents: false, supportsEffort: true, control: true };
  const problem = launcherProblem(bin, minBytes);
  if (problem) throw new Error(`${bin}: this is a launcher, not the claude binary; it can override the model, region and credentials (${problem}). Pass the real binary with --claude-bin PATH or --claude-tools-dir DIR`);
  version = version ?? path.basename(path.dirname(bin)).match(/^\d+(\.\d+)+$/)?.[0] ?? 'unknown';
  return { bin, version, sha256: sandbox.sha256File(bin), supportsHookEvents: binaryContains(bin, '--include-hook-events'), supportsEffort: binaryContains(bin, '--effort') };
}

/**
 * Claude Code binaries recorded by earlier commands into the same --out that differ from `claude`. A tools directory
 * is upgraded in place and --claude-tools-dir takes its newest version, so without this one study could mix versions.
 */
function claudeChanges(configs, claude) {
  const out = [];
  for (const c of configs) {
    const rec = c?.claudeCode;
    if (!rec?.binarySha256 || rec.binarySha256 === claude.sha256 || out.some((o) => o.binarySha256 === rec.binarySha256)) continue;
    out.push({ version: rec.version ?? null, binarySha256: rec.binarySha256, startedAt: c.startedAt ?? null });
  }
  return out;
}

/**
 * The error for `changes`, naming both binaries and the ways out. run-config holds no path under HOME, so the path to
 * pin is rebuilt from `toolsDir` and the recorded version, and offered only when that binary is still there.
 */
function describeClaudeChanges(changes, claude, outDir, toolsDir = null) {
  const was = changes.map((c) => `claude ${c.version ?? 'unknown'}, sha256 ${c.binarySha256.slice(0, 12)}${c.startedAt ? `, recorded ${c.startedAt}` : ''}`).join('; ');
  const pin = toolsDir ? changes.map((c) => c.version && /^\d+(\.\d+)+$/.test(c.version) && path.join(toolsDir, c.version, 'claude')).find((f) => f && executable(f)) : null;
  return `${outDir} holds runs of ${was}; this command resolved claude ${claude.version} (${claude.bin}), sha256 ${claude.sha256.slice(0, 12)}. One study must use one claude binary: ${pin ? `pass --claude-bin ${pin}, ` : ''}use a new --out, or pass --allow-claude-change to mix them anyway`;
}

/** A warning line when `version` is not the one the harness was validated against, else null. */
const versionWarning = (version) => (version === VALIDATED_VERSION ? null : `claude ${version} differs from ${VALIDATED_VERSION}, the version this harness was validated against; stream fields or flags may differ`);

module.exports = { resolveClaude, isPlantControl, claudeChanges, describeClaudeChanges, MIN_BINARY_BYTES, VALIDATED_VERSION, versionWarning, binaryContains, compareVersions, launcherProblem };
