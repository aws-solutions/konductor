// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runChecks } = require('./checks.js');
const { buildResult, errorResult, validateResult } = require('./result.js');
const { buildCheckEnv } = require('./env.js');
const { harnessFor, kiro } = require('./harness/index.js');
const { makeIsolation } = require('./isolate.js');
const { createTripwire, tripwireFlags } = require('./tripwire.js');
const procs = require('./procs.js');
const sandbox = require('./sandbox.js');

const SNAPSHOT_SKIP = new Set(['node_modules', '.git']);

// Spawns in its own process group so a timeout kills child tools too. The group is
// registered so a runner interrupted by a signal can kill it.
function spawnWithTimeout(cmd, args, { cwd, env, timeoutMs, stdoutPath, stderrPath }) {
  return new Promise((resolve) => {
    const out = fs.openSync(stdoutPath, 'w');
    const err = fs.openSync(stderrPath, 'w');
    const started = Date.now();
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, err], detached: true });
    } catch (e) {
      fs.closeSync(out); fs.closeSync(err);
      resolve({ exitCode: null, timedOut: false, wallClockMs: 0, error: e.message });
      return;
    }
    if (child.pid) procs.trackGroup(child.pid);
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
    const finish = (result) => {
      if (child.pid) procs.untrackGroup(child.pid);
      fs.closeSync(out); fs.closeSync(err);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ exitCode: null, timedOut, wallClockMs: Date.now() - started, error: e.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      kill('SIGKILL'); // stragglers in the group would otherwise recreate files in the scratch HOME
      finish({
        exitCode: code,
        timedOut,
        wallClockMs: Date.now() - started,
        error: signal && !timedOut ? `killed by ${signal}` : null,
      });
    });
  });
}

// Regular files and directories only: a socket, FIFO or device the agent left behind makes cpSync throw.
function snapshotWorkspace(cwd, dest) {
  fs.cpSync(cwd, dest, {
    recursive: true,
    filter: (p) => {
      if (SNAPSHOT_SKIP.has(path.basename(p))) return false;
      const st = fs.lstatSync(p);
      return st.isDirectory() || st.isFile();
    },
  });
}

function makeIso(ctx, arm, scratchRoot) {
  return makeIsolation({
    mode: ctx.isolation.mode, scratchRoot, hide: ctx.hide || [], mask: ctx.mask || [], keyRoots: ctx.keyRoots || [], keep: harnessFor(arm).keepPaths(ctx),
  });
}

// Everything that happens after the agent exits. Fills `acc` as it goes so a throw
// part-way keeps what was already computed (spend in particular).
function postProcess({ acc, task, arm, ctx, outDir, runRoot, home, cwd, iso, tripwire }) {
  const harness = harnessFor(arm);
  harness.parseResult(outDir, { home, tmpdir: path.join(runRoot, 'tmp'), acc, arm, ctx, config: ctx.config });

  try {
    snapshotWorkspace(cwd, path.join(outDir, 'workspace'));
  } catch {
    acc.meta.flags.push('snapshotFailed');
  }
  const checkHome = path.join(runRoot, 'check-home');
  fs.mkdirSync(path.join(checkHome, 'tmp'), { recursive: true });
  const { env } = buildCheckEnv(process.env, { home: checkHome, konductor: false });
  acc.checks = runChecks(cwd, task.checks, {
    pristineDir: task.fixtureDir,
    env,
    wrapCmd: (cmd) => iso.wrap('sh', ['-c', cmd]),
    hiddenDir: task.hiddenDir,
    scratchDir: path.join(runRoot, 'check-scratch'),
  });
  harness.collectArtifacts(home, outDir);

  const trip = tripwire.check();
  acc.meta.homeTripwireHits = trip.hits;
  acc.meta.flags.push(...tripwireFlags(trip, iso.mode));
}

async function executeRun({ arm, task, replicate, ctx, prepared, outDir, inFlightAtStart = null }) {
  const { config } = ctx;
  const harness = harnessFor(arm);
  const base = { arm, task, replicate, config, env: ctx.envInfo };
  const meta = { flags: [], isolation: ctx.isolation.mode, inFlightAtStart, mcpSha256: prepared?.mcpSha256 ?? null, agentStarted: false };
  let result;
  let runRoot = null;
  let home = null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    runRoot = fs.mkdtempSync(path.join(ctx.scratchDir, 'r-'));
  } catch (e) {
    meta.infraError = `cannot create run directories: ${e.message}`;
    result = errorResult({ ...base, message: meta.infraError, meta });
  }

  if (!result) {
    home = path.join(runRoot, 'home');
    const cwd = path.join(runRoot, 'work');
    const acc = { agg: null, session: null, checks: [], transcript: null, meta };
    let exec = null;
    try {
      Object.assign(meta, harness.installInto(home, { arm, prepared, ctx, config, outDir }));
      sandbox.copyFixture(task.fixtureDir, cwd);
      const leaked = sandbox.findAnswerKey(cwd);
      if (leaked) throw new Error(`answer key present in the agent working directory: ${leaked}`);
      fs.mkdirSync(path.join(runRoot, 'tmp'), { recursive: true });
    } catch (e) {
      meta.infraError = e.message;
      result = errorResult({ ...base, message: `setup failed: ${e.message}`, meta });
    }

    if (!result) {
      const iso = makeIso(ctx, arm, runRoot);
      const tripwire = createTripwire({ markerPath: path.join(runRoot, '.marker'), ...ctx.tripwire });
      try {
        const tmpdir = path.join(runRoot, 'tmp');
        const env = harness.env({ arm, config, ctx, home, tmpdir });
        const cmd = harness.buildCommand({ arm, task, config, ctx, cwd });
        fs.writeFileSync(path.join(outDir, 'command.txt'), `${cmd.display}\n(cwd=<fresh copy of fixture ${task.fixture}>, isolation=${iso.mode})\n`);
        const w = iso.wrap(cmd.file, cmd.args);
        tripwire.start();
        meta.agentStarted = true;
        const startedAt = new Date().toISOString();
        exec = await spawnWithTimeout(w.file, w.args, {
          cwd, env, timeoutMs: task.timeoutSec * 1000,
          stdoutPath: path.join(outDir, 'stream.jsonl'), stderrPath: path.join(outDir, 'stderr.txt'),
        });
        exec.startedAt = startedAt;
      } catch (e) {
        meta.infraError = e.message;
        exec = { timedOut: false, exitCode: null, wallClockMs: null, error: e.message };
      }
      harness.removeCredentials(home);

      if (fs.existsSync(path.join(outDir, 'stream.jsonl'))) {
        try {
          postProcess({ acc, task, arm, ctx, outDir, runRoot, home, cwd, iso, tripwire });
        } catch (e) {
          meta.infraError = [meta.infraError, `post-processing failed: ${e.message}`].filter(Boolean).join(' | ');
        }
      }
      if (harness.finalize && harness.finalize(outDir, ctx) > 0) meta.flags.push('credsRedacted');
      result = buildResult({ ...base, exec, agg: acc.agg, session: acc.session, usage: acc.usage ?? null, skills: acc.skills ?? null, checks: acc.checks, transcript: acc.transcript, meta });
    }
  }

  if (runRoot) {
    if (home) harness.removeCredentials(home);
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
  const problems = validateResult(result);
  if (problems.length) result.error = [result.error, `schema: ${problems.join('; ')}`].filter(Boolean).join(' | ');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  } catch { /* the caller still gets the result object */ }
  return result;
}

module.exports = { executeRun, kiroArgs: kiro.kiroArgs, spawnWithTimeout, readTranscripts: kiro.readTranscripts };
