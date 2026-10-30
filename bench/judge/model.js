// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { buildChildEnv } = require('../runner/lib/env.js');
const sandbox = require('../runner/lib/sandbox.js');
const { spawnWithTimeout } = require('../runner/lib/run-one.js');
const { makeIsolation } = require('../runner/lib/isolate.js');
const procs = require('../runner/lib/procs.js');

// A caller is async ({model, prompt}) => {text, credits, latencyMs, error?, cached?}.

const sha12 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

// Runs the judge as its own headless kiro-cli call: scratch HOME with no agents,
// steering, skills or memories, an empty cwd, and no tools trusted. With an isolation
// mode (unshare or sandbox-exec) the call runs under the same containment as the agent runs, so the
// only credentials it can see are its own scratch auth copy. Each call's raw stream is kept
// under rawDir for audit. The scratch root is registered so an interrupted judge phase removes it.
function makeKiroCaller({ authDb, timeoutMs, scratchRoot = os.tmpdir(), kiroBin = sandbox.resolveKiroCli().bin, isolation = { mode: 'none' }, rawDir = null }) {
  return async ({ model, prompt }) => {
    const root = fs.mkdtempSync(path.join(scratchRoot, 'bench-judge-'));
    procs.trackScratch(root);
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'cwd');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
    const outPath = path.join(root, 'stdout.jsonl');
    const errPath = path.join(root, 'stderr.txt');
    try {
      sandbox.emptyKiroHome(home);
      sandbox.copyAuthDb(authDb, home);
      const { env } = buildChildEnv(process.env, { home, tmpdir: path.join(root, 'tmp'), agentEngine: 'v2' });
      const args = ['chat', '--no-interactive', '--model', model, '--trust-tools=', '--output-format', 'stream-json', prompt];
      const iso = makeIsolation({ mode: isolation.mode, scratchRoot: root, hide: isolation.hide || [], keep: [kiroBin] });
      const w = iso.wrap(kiroBin, args);
      const exec = await spawnWithTimeout(w.file, w.args, { cwd, env, timeoutMs, stdoutPath: outPath, stderrPath: errPath });
      keepRaw(rawDir, model, prompt, outPath, errPath);
      const agg = aggregateStream(parseStream(fs.readFileSync(outPath, 'utf8')).events);
      const base = { credits: agg.credits, latencyMs: exec.wallClockMs };
      if (exec.timedOut) return { ...base, text: '', error: `timed out after ${timeoutMs} ms` };
      if (exec.exitCode !== 0 || agg.runFinishedStatus !== 'success' || !agg.finalText) {
        const tail = fs.readFileSync(errPath, 'utf8').trim().slice(-200);
        return { ...base, text: '', error: `kiro-cli exit ${exec.exitCode}, status ${agg.runFinishedStatus}${tail ? `: ${tail}` : ''}` };
      }
      return { ...base, text: agg.finalText };
    } finally {
      fs.rmSync(path.join(home, '.local/share/kiro-cli/data.sqlite3'), { force: true });
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      procs.untrackScratch(root);
    }
  };
}

function keepRaw(rawDir, model, prompt, outPath, errPath) {
  if (!rawDir) return;
  try {
    fs.mkdirSync(rawDir, { recursive: true });
    const stem = path.join(rawDir, `${model.replace(/[^\w.-]/g, '_')}-${sha12(`${model}\n${prompt}`)}-${Date.now()}`);
    fs.copyFileSync(outPath, `${stem}.jsonl`);
    if (fs.statSync(errPath).size) fs.copyFileSync(errPath, `${stem}.stderr.txt`);
  } catch { /* auditing must not fail the judge call */ }
}

// Test and offline hook: `<cmd> <model>` with the prompt on stdin and the reply on stdout.
// The command string is split on whitespace (no quoting).
function makeCmdCaller(cmd, { timeoutMs }) {
  const [bin, ...pre] = cmd.trim().split(/\s+/);
  return ({ model, prompt }) => new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(bin, [...pre, model], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    if (child.pid) procs.trackGroup(child.pid);
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
    let out = '';
    let err = '';
    const timer = setTimeout(killGroup, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); if (child.pid) procs.untrackGroup(child.pid); resolve({ text: '', credits: 0, latencyMs: Date.now() - started, error: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      killGroup();
      if (child.pid) procs.untrackGroup(child.pid);
      const latencyMs = Date.now() - started;
      if (code !== 0) resolve({ text: '', credits: 0, latencyMs, error: `judge command exit ${code}: ${err.trim().slice(-200)}` });
      else resolve({ text: out.trim(), credits: 0, latencyMs });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// Keyed by hash of (model, prompt). The prompt is stored so a leak scan can run later.
function withCache(caller, dir) {
  return async ({ model, prompt }) => {
    const sha = crypto.createHash('sha256').update(`${model}\n${prompt}`).digest('hex');
    const file = path.join(dir, `${sha}.json`);
    if (fs.existsSync(file)) {
      const e = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { text: e.response, credits: 0, originalCredits: e.credits, latencyMs: e.latencyMs, cached: true };
    }
    const r = await caller({ model, prompt });
    if (!r.error && r.text) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ model, promptSha: sha, prompt, response: r.text, credits: r.credits, latencyMs: r.latencyMs }));
    }
    return r;
  };
}

module.exports = { makeKiroCaller, makeCmdCaller, withCache };
