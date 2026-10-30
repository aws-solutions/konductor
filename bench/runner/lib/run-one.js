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
const real = require('./real.js');
const { parseStream } = require('./stream.js');
const { scanStream, fixRecall, contaminationFlags } = require('./contamination.js');
const { newConversation } = require('./autonomy.js');

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

// A real task also hides the host copies of its project and the package caches. Its checks run with no network.
function makeIso(ctx, arm, scratchRoot, task, { offline = false } = {}) {
  const extra = task?.real ? real.hidePaths(task, { cache: ctx.realCache }) : [];
  return makeIsolation({
    mode: ctx.isolation.mode, scratchRoot, hide: [...(ctx.hide || []), ...extra], mask: ctx.mask || [], keyRoots: ctx.keyRoots || [], keep: harnessFor(arm).keepPaths(ctx), offline,
  });
}

// Reads the stream and the final tree of a real run: fetches made by the agent and verbatim use of the upstream fix.
function auditContamination({ task, ctx, outDir, cwd }) {
  const stream = path.join(outDir, 'stream.jsonl');
  const { events } = parseStream(fs.existsSync(stream) ? fs.readFileSync(stream, 'utf8') : '');
  const externalFetch = scanStream(events, task.realEntry).map((f) => `${f.tool}: ${f.text}`);
  const recall = fixRecall({ baseDir: real.pristineDir(task, { cache: ctx.realCache }), workDir: cwd, patch: real.fixPatchText(task, { cache: ctx.realCache }) });
  const record = { externalFetch, fixRecallChars: recall.matchedChars };
  return { record, flags: contaminationFlags(record) };
}

// Everything that happens after the agent exits. Fills `acc` as it goes so a throw
// part-way keeps what was already computed (spend in particular).
function postProcess({ acc, task, arm, ctx, outDir, runRoot, home, cwd, iso, tripwire }) {
  const checkIso = task.real ? makeIso(ctx, arm, runRoot, task, { offline: true }) : iso;
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
    pristineDir: task.real ? real.pristineDir(task, { cache: ctx.realCache }) : task.fixtureDir,
    env,
    wrapCmd: (cmd) => checkIso.wrap('sh', ['-c', cmd]),
    hiddenDir: task.hiddenDir,
    scratchDir: path.join(runRoot, 'check-scratch'),
    real: task.real ? real.testSpec(task) : undefined,
  });
  if (task.real) {
    try {
      const audit = auditContamination({ task, ctx, outDir, cwd });
      acc.meta.contamination = audit.record;
      acc.meta.flags.push(...audit.flags);
    } catch (e) {
      acc.meta.flags.push('contaminationUnchecked');
      acc.meta.contamination = { externalFetch: [], fixRecallChars: 0, error: e.message };
    }
  }
  try {
    harness.collectArtifacts(home, outDir);
  } catch {
    acc.meta.flags.push('artifactCopyFailed');
  }

  const trip = tripwire.check();
  acc.meta.homeTripwireHits = trip.hits;
  acc.meta.flags.push(...tripwireFlags(trip, iso.mode, iso.writableInHome));
}


const streamFile = (multi, turn) => (multi ? `stream-${turn}.jsonl` : 'stream.jsonl');
const stderrFile = (multi, turn) => (multi ? `stderr-${turn}.txt` : 'stderr.txt');

function readIfPresent(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

// Joins the per-turn files into the file the parsers and scanners read, one line per event across turn boundaries.
function concatTurnFiles(outDir, base, name, turns) {
  const parts = [];
  let any = false;
  for (let n = 1; n <= turns; n++) {
    if (!fs.existsSync(path.join(outDir, name(true, n)))) continue;
    any = true;
    const t = readIfPresent(path.join(outDir, name(true, n)));
    if (t) parts.push(t.endsWith('\n') ? t : `${t}\n`);
  }
  if (any) fs.writeFileSync(path.join(outDir, base), parts.join(''));
}

/**
 * Runs the agent: once, or for an autonomy task as a conversation. After a turn that ended cleanly and asked
 * something, the scripted user answers and the same session resumes (same cwd, same scratch HOME, so the credential
 * copy is still there). The task timeout is one budget for all turns. Every turn goes through the same isolation.
 * Fills `conv` as it goes; returns the combined exec record.
 */
async function runTurns({ harness, arm, task, config, ctx, cwd, env, iso, outDir, conv, startedAt }) {
  const multi = Boolean(task.autonomy);
  const deadline = Date.now() + task.timeoutSec * 1000;
  const execs = [];
  let resume = null;
  let sessionId = null;
  let turn = 0;
  try {
    for (;;) {
      turn++;
      const remaining = deadline - Date.now();
      if (turn > 1 && remaining <= 0) {
        execs.push({ exitCode: null, timedOut: true, wallClockMs: 0, error: null });
        break;
      }
      const cmd = harness.buildCommand({ arm, task, config, ctx, cwd, resume });
      if (turn === 1) {
        fs.writeFileSync(path.join(outDir, 'command.txt'), `${cmd.display}\n(cwd=<fresh copy of ${task.real ? `real task ${task.real}` : `fixture ${task.fixture}`}>, isolation=${iso.mode})\n`);
      } else {
        fs.appendFileSync(path.join(outDir, 'command.txt'), `--- turn ${turn} (resumed) ---\n${cmd.display}\n`);
      }
      const w = iso.wrap(cmd.file, cmd.args);
      const exec = await spawnWithTimeout(w.file, w.args, {
        cwd, env, timeoutMs: Math.max(1, remaining),
        stdoutPath: path.join(outDir, streamFile(multi, turn)), stderrPath: path.join(outDir, stderrFile(multi, turn)),
      });
      execs.push(exec);
      if (!multi) break;
      const clean = exec.exitCode === 0 && !exec.timedOut && !exec.error;
      const summary = clean ? harness.turnSummary(readIfPresent(path.join(outDir, streamFile(multi, turn)))) : null;
      const finished = summary && summary.runFinishedStatus === 'success' ? summary : null;
      const reply = conv.record(finished);
      if (!reply) break;
      sessionId = finished.sessionId ?? sessionId;
      resume = { sessionId, prompt: reply.text };
    }
  } finally {
    if (multi) {
      concatTurnFiles(outDir, 'stream.jsonl', streamFile, turn);
      concatTurnFiles(outDir, 'stderr.txt', stderrFile, turn);
    }
  }
  const last = execs[execs.length - 1];
  return {
    exitCode: last.exitCode,
    timedOut: execs.some((e) => e.timedOut),
    wallClockMs: execs.reduce((n, e) => n + (e.wallClockMs ?? 0), 0),
    error: last.error ?? null,
    startedAt,
  };
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
    const conv = task.autonomy ? newConversation(task.autonomy) : null;
    try {
      Object.assign(meta, harness.installInto(home, { arm, prepared, ctx, config, outDir }));
      if (task.real) real.materializeInto(task, cwd, { cache: ctx.realCache });
      else sandbox.copyFixture(task.fixtureDir, cwd);
      const leaked = sandbox.findAnswerKey(cwd);
      if (leaked) throw new Error(`answer key present in the agent working directory: ${leaked}`);
      fs.mkdirSync(path.join(runRoot, 'tmp'), { recursive: true });
    } catch (e) {
      meta.infraError = e.message;
      result = errorResult({ ...base, message: `setup failed: ${e.message}`, meta });
    }

    if (!result) {
      const iso = makeIso(ctx, arm, runRoot, task);
      const tripwire = createTripwire({ markerPath: path.join(runRoot, '.marker'), ...ctx.tripwire });
      try {
        const tmpdir = path.join(runRoot, 'tmp');
        const env = harness.env({ arm, config, ctx, home, tmpdir });
        tripwire.start();
        meta.agentStarted = true;
        exec = await runTurns({ harness, arm, task, config, ctx, cwd, env, iso, outDir, conv, startedAt: new Date().toISOString() });
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
      result = buildResult({ ...base, exec, agg: acc.agg, session: acc.session, usage: acc.usage ?? null, skills: acc.skills ?? null, checks: acc.checks, transcript: acc.transcript, meta, conv });
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

module.exports = { executeRun, makeIso, kiroArgs: kiro.kiroArgs, spawnWithTimeout, readTranscripts: kiro.readTranscripts };
