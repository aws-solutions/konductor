// SPDX-License-Identifier: Apache-2.0
'use strict';

// Processes for the after-capability chain: one child at a time that a stop signal can end, naps a stop cuts short,
// scratch HOME and TMPDIR dirs around every bench.js call, and the checks on other processes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

/** Whether pid names a live process this user may signal. */
function alive(pid) {
  if (!/^\d+$/.test(String(pid || '')) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

const cmdline = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return ''; } };
const readTrim = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/\n+$/, ''); } catch { return ''; } };

/** Sleep for s seconds; a stop signal (ctx.napCancel) ends it early. */
function nap(ctx, s) {
  return new Promise((resolve) => {
    const t = setTimeout(done, s * 1000);
    function done() { clearTimeout(t); ctx.napCancel = null; resolve(); }
    ctx.napCancel = done;
  });
}

/**
 * Start one child with stdout and stderr appended to a file, stdin closed, and wait for it.
 * @param {object} ctx chain context; ctx.child holds the child so a stop signal can end it
 * @param {string} cmd program
 * @param {string[]} args arguments
 * @param {{out:string, cwd?:string, env?:object}} o out the file to append to
 * @returns {Promise<number>} exit status, or 128 + signal number when a signal ended it
 */
function runChild(ctx, cmd, args, { out, cwd, env }) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fd = fs.openSync(out, 'a');
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd, env, stdio: ['ignore', fd, fd] });
    ctx.child = c;
    const end = (rc) => { ctx.child = null; fs.closeSync(fd); resolve(rc); };
    c.on('error', () => end(127));
    c.on('exit', (code, sig) => end(code ?? 128 + (os.constants.signals[sig] || 0)));
  });
}

/** Make the scratch HOME and TMPDIR for one bench.js call. */
function newScratch(ctx) {
  const sp = ctx.cfg.scratchParent;
  const home = fs.mkdtempSync(path.join(sp, 'ac-home.'));
  ctx.scratch = [home];
  const tmp = fs.mkdtempSync(path.join(sp, 'ac-tmp.'));
  ctx.scratch.push(tmp);
  return { home, tmp };
}

/** Remove the scratch dirs newScratch made (only paths under the scratch parent with its prefixes). */
function dropScratch(ctx) {
  const sp = ctx.cfg.scratchParent;
  for (const d of ctx.scratch) {
    if (d.startsWith(`${sp}/ac-home.`) || d.startsWith(`${sp}/ac-tmp.`)) fs.rmSync(d, { recursive: true, force: true });
  }
  ctx.scratch = [];
}

/** process.env minus BENCH_JUDGE_CMD, plus the scratch HOME and TMPDIR. */
function scratchEnv(s) {
  const env = { ...process.env, HOME: s.home, TMPDIR: s.tmp };
  delete env.BENCH_JUDGE_CMD;
  return env;
}

/**
 * bench.js with a scratch HOME and a TMPDIR without "bench"; output appended to out.
 * @returns {Promise<number>} exit status; 99 when the scratch dirs cannot be made
 */
async function nodeRun(ctx, out, args) {
  let s;
  try { s = newScratch(ctx); } catch {
    dropScratch(ctx);
    ctx.say(`cannot create scratch dirs under ${ctx.cfg.scratchParent}`);
    return 99;
  }
  const rc = await runChild(ctx, 'node', [ctx.cfg.cliJs, ...args], { out, cwd: ctx.cfg.repo, env: scratchEnv(s) });
  dropScratch(ctx);
  return rc;
}

/** This process and its ancestors: their command lines carry the chain's own name and pattern. */
function selfAndAncestors() {
  const pids = new Set([String(process.pid)]);
  let p = String(process.pid);
  for (;;) {
    const m = /^PPid:\s*(\d+)/m.exec(readTrim(`/proc/${p}/status`));
    if (!m || Number(m[1]) <= 1) break;
    p = m[1];
    pids.add(p);
  }
  return pids;
}

/** Command lines matching the bench process pattern, minus pgrep/grep and this process with its ancestors. */
function benchProcs(ctx) {
  const r = spawnSync('pgrep', ['-af', ctx.cfg.benchProcPattern], { encoding: 'utf8' });
  const skip = selfAndAncestors();
  return String(r.stdout || '').split('\n').filter((l) => {
    const m = /^(\d+) (\S+)/.exec(l);
    return m && !skip.has(m[1]) && !/^(pgrep|grep)$/.test(m[2]);
  });
}

/** The capability study: whether its pid is alive and is run-real-pilot, and the last non-empty line of its log. */
function pilotState(ctx) {
  const c = ctx.cfg;
  const pid = readTrim(c.pilotPidfile);
  const isPilot = alive(pid) && new RegExp(c.pilotProcPattern).test(cmdline(pid));
  let last = '';
  try {
    const lines = fs.readFileSync(c.pilotLog, 'utf8').split('\n');
    last = lines.slice(-31).filter((l) => !/^\s*$/.test(l)).pop() || '';
  } catch { /* no log yet */ }
  return { alive: isPilot, pid, last };
}

const isDoneLine = (l) => /^\[[^\]]*\] DONE:/.test(l || '');
const isFailedLine = (l) => /^\[[^\]]*\] FAILED/.test(l || '');

/** Whole GB free on the filesystem of dir (df's Available column), or '' when it cannot be read. */
function freeGb(dir) {
  try { const s = fs.statfsSync(dir); return String(Math.floor((s.bavail * s.bsize) / 1073741824)); } catch { return ''; }
}

/** Run a command to completion with its output appended to a file; returns its exit status. */
function runSyncTo(file, cmd, args, o = {}) {
  const fd = fs.openSync(file, 'a');
  try {
    const r = spawnSync(cmd, args, { stdio: ['ignore', fd, fd], ...o });
    return r.status ?? 1;
  } finally { fs.closeSync(fd); }
}

module.exports = {
  alive, cmdline, readTrim, nap, runChild, newScratch, dropScratch, scratchEnv, nodeRun, benchProcs, pilotState,
  isDoneLine, isFailedLine, freeGb, runSyncTo,
};
