// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-test results for the `real` task track. A test command prints its results in a runner
// specific format; the parsers below turn them into Map<testId, 'pass'|'fail'>, and scoreReal
// compares that with the lists pinned in the manifest. A listed id that never appears counts as failed.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPORTER_PATH = path.join(__dirname, 'node-test-reporter.js');
const PYTEST_LINE = /^(\S.*?\.py::.+?) (PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)(?= |$)/;

// An id that occurs more than once passes only if every occurrence passed.
function record(map, id, status) {
  map.set(id, map.get(id) === 'fail' ? 'fail' : status);
}

// Expects `pytest -v`: `path::name STATUS [ NN%]`. Short-summary lines start with the status and never match.
function parsePytest(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    const m = PYTEST_LINE.exec(line.trimEnd());
    if (m) record(out, m[1], m[2] === 'PASSED' ? 'pass' : 'fail');
  }
  return out;
}

// Reads the `@@T` lines written by node-test-reporter.js.
function parseNodeTest(text) {
  const out = new Map();
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('@@T ')) continue;
    let ev;
    try { ev = JSON.parse(line.slice(4)); } catch { continue; }
    if (!ev || !Array.isArray(ev.path) || (ev.status !== 'pass' && ev.status !== 'fail')) continue;
    record(out, `${ev.file}::${ev.path.join(' > ')}`, ev.status);
  }
  return out;
}

const PARSERS = { pytest: parsePytest, 'node-test': parseNodeTest };
const RUNNERS = Object.keys(PARSERS);

function parseResults(runner, text) {
  const parse = PARSERS[runner];
  if (!parse) throw new Error(`unknown runner "${runner}" (expected ${RUNNERS.join(' or ')})`);
  return parse(text);
}

function scoreReal({ results, failToPass, passToPass }) {
  const count = (ids) => ({ passed: ids.filter((id) => results.get(id) === 'pass').length, total: ids.length });
  return { failToPass: count(failToPass), passToPass: count(passToPass) };
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// `{reporter}` stands for the absolute path of node-test-reporter.js.
function buildCommand(cmd, reporterPath = REPORTER_PATH) {
  return cmd.replace(/\{reporter\}/g, shq(reporterPath));
}

const SKIP_COPY = new Set(['.bench-answer-key.md']);

// Regular files and directories only: a socket or FIFO left behind by the agent would make cpSync throw.
function copyRegular(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const st = fs.lstatSync(p);
      return (st.isDirectory() || st.isFile() || st.isSymbolicLink()) && !SKIP_COPY.has(path.basename(p));
    },
  });
}

// File-level overlay: each file under `overlayDir` replaces or adds the file at the same relative path.
// Other files in the same directories stay, unlike the directory overlay used by the hard tasks.
function overlayFiles(overlayDir, dest) {
  for (const e of fs.readdirSync(overlayDir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const rel = path.relative(overlayDir, path.join(e.parentPath ?? e.path, e.name));
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.rmSync(target, { force: true });
    fs.copyFileSync(path.join(overlayDir, rel), target);
  }
}

/**
 * Runs the task's test command in a scratch copy of `root` with the hidden test files laid over it, and
 * parses per-test results. The agent's directory never holds the hidden files.
 * spec: {runner, cmd, env, timeoutSec}. opts: {overlayDir, env, wrapCmd(cmd) -> {file,args}, scratchDir}.
 * Returns {results, exitCode, timedOut, seconds, tail}; results is empty when nothing parsed.
 */
function runRealTests(root, spec, { overlayDir, env, wrapCmd, scratchDir } = {}) {
  const parent = scratchDir || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  // Canonical, so the cwd matches the paths the test processes report (macOS /var is /private/var).
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'real-')));
  try {
    copyRegular(root, scratch);
    if (overlayDir) overlayFiles(overlayDir, scratch);
    const secs = Math.max(1, Math.ceil((spec.timeoutSec ?? 120)));
    const inner = `timeout -s KILL ${secs} sh -c ${shq(buildCommand(spec.cmd))}`;
    const w = wrapCmd ? wrapCmd(inner) : { file: 'sh', args: ['-c', inner] };
    const started = Date.now();
    const r = spawnSync(w.file, w.args, {
      cwd: scratch, encoding: 'utf8', env: { ...(env || process.env), ...(spec.env || {}) },
      timeout: (secs + 15) * 1000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024,
    });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    const timedOut = r.status === 124 || r.status === 137 || r.signal === 'SIGKILL' || (r.error && r.error.code === 'ETIMEDOUT');
    return {
      results: parseResults(spec.runner, text),
      exitCode: r.status === null ? -1 : r.status,
      timedOut: Boolean(timedOut),
      seconds: (Date.now() - started) / 1000,
      tail: text.trim().split('\n').slice(-8).join('\n'),
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = { parsePytest, parseNodeTest, parseResults, scoreReal, buildCommand, runRealTests, overlayFiles, copyRegular, REPORTER_PATH, RUNNERS };
