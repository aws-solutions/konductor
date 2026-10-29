// SPDX-License-Identifier: Apache-2.0
'use strict';

// The one implementation of task checks. The runner (checks.js) and the task
// validator (tasks/validate-tasks.js) both call evalCheck, so a reference
// solution that passes validation passes in a real run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { countLabelledFindings } = require('./findings.js');

const PATTERN_FLAGS = 'im';
const CMD_TIMEOUT_MS = 60000;
const CHECK_TYPES = ['file_exists', 'contains', 'not_contains', 'min_matches', 'fixture_unchanged', 'cmd', 'labelled_findings', 'tests'];
const TESTS_TIMEOUT_MS = 60000;
const ANSWER_KEY = '.bench-answer-key.md';
const COMPARE_SKIP = new Set(['node_modules', '.git', ANSWER_KEY]);

function resolveInside(root, rel) {
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`path escapes workspace: ${rel}`);
  return full;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readTreeFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (COMPARE_SKIP.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...readTreeFiles(dir, r));
    else out.push(r);
  }
  return out.sort();
}

// Byte comparison of a file or a directory tree. Returns null when equal, else a reason.
function diffPaths(actual, pristine) {
  const a = fs.lstatSync(actual);
  const p = fs.lstatSync(pristine);
  if (a.isDirectory() !== p.isDirectory()) return 'file/directory mismatch';
  if (!p.isDirectory()) return fs.readFileSync(actual).equals(fs.readFileSync(pristine)) ? null : 'content differs';
  const af = readTreeFiles(actual);
  const pf = readTreeFiles(pristine);
  if (af.join('\n') !== pf.join('\n')) {
    const missing = pf.filter((f) => !af.includes(f));
    const extra = af.filter((f) => !pf.includes(f));
    return `file set differs (missing ${missing.length}, extra ${extra.length})`;
  }
  const changed = pf.find((f) => !fs.readFileSync(path.join(actual, f)).equals(fs.readFileSync(path.join(pristine, f))));
  return changed ? `content differs: ${changed}` : null;
}

function cmdResult(root, check, opts) {
  const wrap = opts.wrapCmd ? opts.wrapCmd(check.cmd) : { file: 'sh', args: ['-c', check.cmd] };
  const r = spawnSync(wrap.file, wrap.args, { cwd: root, encoding: 'utf8', timeout: CMD_TIMEOUT_MS, env: opts.env });
  const want = check.expectExit ?? 0;
  const exit = r.status === null ? -1 : r.status;
  return { passed: exit === want, detail: `exit ${exit}, expected ${want}`, exit, stderr: r.stderr || '', signal: r.signal };
}

// `node --test` prints its totals as TAP ("# pass 5") or in the spec reporter ("ℹ pass 5").
// A summary without both the tests and pass lines is not trusted.
function parseNodeTestSummary(text) {
  const n = {};
  for (const m of String(text).matchAll(/^\s*(?:#|\u2139)\s+(tests|pass)\s+(\d+)\s*$/gm)) n[m[1]] = Number(m[2]);
  return n.tests === undefined || n.pass === undefined ? null : { passed: n.pass, total: n.tests };
}

// Sum of the `tests` checks of one run, or null when it has none.
function aggregateHidden(checks) {
  const parts = (checks || []).filter((c) => c.type === 'tests' && c.tests);
  if (!parts.length) return null;
  return {
    passed: parts.reduce((s, c) => s + c.tests.passed, 0),
    total: parts.reduce((s, c) => s + c.tests.total, 0),
    unparsed: parts.some((c) => c.tests.unparsed === true),
  };
}

// Regular files and directories only: a socket or FIFO left by the agent would make cpSync throw.
function copyRegular(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (p) => {
      const st = fs.lstatSync(p);
      return (st.isDirectory() || st.isFile()) && path.basename(p) !== ANSWER_KEY;
    },
  });
}

// Inside a `node --test` parent the variable below makes a nested `node --test` print a binary stream
// instead of a summary.
function testEnv() {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return env;
}

// Runs the hidden tests in a scratch copy of `root`: the overlay replaces whatever the agent left at
// the same paths, and neither the workspace nor the agent's cwd ever sees the hidden files.
function testsResult(root, check, opts) {
  const known = Number.isInteger(check.min) ? check.min : 0;
  const unparsed = (why) => ({
    passed: false, detail: `0/${known} hidden tests passed (unparsed: ${why})`, tests: { passed: 0, total: known, unparsed: true },
  });
  if (!opts.hiddenDir || !fs.existsSync(opts.hiddenDir)) return unparsed('no hidden directory');
  const parent = opts.scratchDir || os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(parent, 'hidden-'));
  try {
    copyRegular(root, scratch);
    for (const name of fs.readdirSync(opts.hiddenDir)) fs.rmSync(path.join(scratch, name), { recursive: true, force: true });
    copyRegular(opts.hiddenDir, scratch);
    const ms = opts.testsTimeoutMs ?? TESTS_TIMEOUT_MS;
    // `timeout` kills the whole process group; a plain kill would leave a runaway test process behind.
    const secs = Math.max(1, Math.ceil(ms / 1000));
    const run = (cmd) => {
      const w = opts.wrapCmd ? opts.wrapCmd(cmd) : { file: 'sh', args: ['-c', cmd] };
      return spawnSync(w.file, w.args, { cwd: scratch, encoding: 'utf8', timeout: ms + 10000, killSignal: 'SIGKILL', env: opts.env ?? testEnv(), maxBuffer: 32 * 1024 * 1024 });
    };
    let r = run(`timeout -s KILL ${secs} sh -c '${check.cmd.replace(/'/g, "'\\''")}'`);
    if (r.status === 127 && /timeout/.test(r.stderr || '')) r = run(check.cmd);
    const timedOut = r.status === 124 || r.status === 137 || (r.error && r.error.code === 'ETIMEDOUT') || r.signal === 'SIGKILL';
    if (timedOut) return unparsed('timed out');
    const parsed = parseNodeTestSummary(`${r.stdout || ''}\n${r.stderr || ''}`);
    if (!parsed) return unparsed(`exit ${r.status === null ? -1 : r.status}, no test summary`);
    const total = Math.max(parsed.total, known);
    const passed = Math.min(parsed.passed, total);
    return { passed: passed === total && total > 0, detail: `${passed}/${total} hidden tests passed`, tests: { passed, total, unparsed: false } };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function patternFail(check) {
  try {
    new RegExp(check.pattern, PATTERN_FLAGS);
    return null;
  } catch (e) {
    return `invalid pattern: ${e.message}`;
  }
}

/**
 * Evaluates one check against `root`.
 * opts.pristineDir: pristine fixture copy, needed by fixture_unchanged.
 * opts.env / opts.wrapCmd: environment and command wrapper for `cmd` and `tests` checks.
 * opts.hiddenDir / opts.scratchDir / opts.testsTimeoutMs: overlay directory, scratch parent and timeout for `tests` checks.
 * Returns {passed, detail}; cmd checks add {exit, stderr, signal}.
 * Throws only for paths that escape root, which callers treat as a failed check.
 */
function evalCheck(root, check, opts = {}) {
  if (!CHECK_TYPES.includes(check.type)) return { passed: false, detail: `unknown check type ${check.type}` };
  if (check.type === 'cmd') return cmdResult(root, check, opts);
  if (check.type === 'tests') return testsResult(root, check, opts);

  const file = resolveInside(root, check.path);
  if (check.type === 'file_exists') {
    const ok = isFile(file);
    return { passed: ok, detail: ok ? 'present' : 'missing' };
  }
  if (check.type === 'fixture_unchanged') {
    if (!opts.pristineDir) return { passed: false, detail: 'no pristine fixture available' };
    const pristine = resolveInside(opts.pristineDir, check.path);
    if (!fs.existsSync(pristine)) return { passed: false, detail: 'path not in the pristine fixture' };
    if (!fs.existsSync(file)) return { passed: false, detail: 'missing' };
    const why = diffPaths(file, pristine);
    return { passed: why === null, detail: why ?? 'identical' };
  }

  if (!isFile(file)) return { passed: false, detail: 'file missing' };
  if (check.type === 'labelled_findings') {
    const { count } = countLabelledFindings(fs.readFileSync(file, 'utf8'), check.labels);
    return { passed: count >= check.min, detail: `${count} labelled findings, need ${check.min}` };
  }
  const bad = patternFail(check);
  if (bad) return { passed: false, detail: bad };
  const text = fs.readFileSync(file, 'utf8');
  if (check.type === 'min_matches') {
    const n = (text.match(new RegExp(check.pattern, `g${PATTERN_FLAGS}`)) || []).length;
    return { passed: n >= check.min, detail: `${n} matches, need ${check.min}` };
  }
  const hit = new RegExp(check.pattern, PATTERN_FLAGS).test(text);
  const passed = check.type === 'contains' ? hit : !hit;
  return { passed, detail: hit ? 'matched' : 'no match' };
}

module.exports = { evalCheck, resolveInside, diffPaths, parseNodeTestSummary, aggregateHidden, TESTS_TIMEOUT_MS, CHECK_TYPES, PATTERN_FLAGS, CMD_TIMEOUT_MS, ANSWER_KEY };
