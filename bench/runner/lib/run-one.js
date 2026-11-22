// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runChecks } = require('./checks.js');
const { buildResult, errorResult, validateResult } = require('./result.js');
const { buildCheckEnv } = require('./env.js');
const { harnessFor, runtimeOf, kiro } = require('./harness/index.js');
const { makeIsolation, liveStdioDir } = require('./isolate.js');
const { createTripwire, tripwireFlags } = require('./tripwire.js');
const procs = require('./procs.js');
const sandbox = require('./sandbox.js');
const real = require('./real.js');
const { parseStream } = require('./stream.js');
const { scanStream, fixRecall, contaminationFlags, canAuditFetches } = require('./contamination.js');
const { newConversation } = require('./autonomy.js');
const { makeCreditMeter } = require('./credit-watch.js');
const { makeStopWatcher } = require('./stop-watch.js');
const { describeChange } = require('./isolation-gates.js');
const { secretLiterals, scrubDeep } = require('./scrub.js');
const { SCRUB_CAUSES } = require('./hygiene.js');
const { writeAtomic } = require('./owned.js');
const { classifyAuthFailure } = require('./auth-failure.js');
const { classifyLaunchFailure } = require('./launch-failure.js');
const { moveFile, UntrustedFileError } = require('./move-file.js');
const { openPlantRun } = require('./plant/lifecycle.js');
const { plantWalls, withCgroup } = require('./plant/walls.js');
const introspect = require('./introspect/index.js');
const { startupRecord } = require('./startup.js');
const introspectReport = require('./introspect/report.js');

const SNAPSHOT_SKIP = new Set(['node_modules', '.git']);

// A live file the agent replaced is not moved. An empty file takes its place in the out dir so readers
// of the stream and stderr do not fail, and the caller flags the run.
function moveLive(src, dest, tampered) {
  try {
    moveFile(src, dest);
  } catch (e) {
    if (!(e instanceof UntrustedFileError)) throw e;
    tampered.push(path.basename(dest));
    fs.rmSync(dest, { force: true });
    fs.writeFileSync(dest, '', { flag: 'wx', mode: 0o600 });
  }
}

// Where the child's stdout and stderr files live while it runs. Normally the final paths in the out dir,
// which is masked from the agent; the runner opens them before the child starts and the child inherits the
// descriptors. On macOS sandbox-exec denies even fstat on a descriptor whose file is under a masked path, and the
// v3 engine's node checks its stdio descriptors at startup and aborts on that failure. With `stdioDir` (see
// liveStdioDir: outside the agent-writable scratch root and frozen by the profile) the files are written there
// and moved to their final paths when the child exits.
function liveStdioPath(finalPath, stdioDir) {
  return stdioDir ? path.join(stdioDir, path.basename(finalPath)) : finalPath;
}

// Spawns in its own process group so a timeout kills child tools too. The group is
// registered so a runner interrupted by a signal can kill it.
// `onSpawn(pid)` is called once the child exists (a plant run sends the gateway its peer then).
function spawnWithTimeout(cmd, args, { cwd, env, timeoutMs, stdoutPath, stderrPath, stdinPath = null, stdioDir = null, creditLimit = null, creditPollMs = 1000, stop = null, onSpawn = null }) {
  return new Promise((resolve) => {
    const liveOut = liveStdioPath(stdoutPath, stdioDir);
    const liveErr = liveStdioPath(stderrPath, stdioDir);
    const out = fs.openSync(liveOut, 'w');
    const err = fs.openSync(liveErr, 'w');
    // A file as stdin ends at its last byte; a pipe left open would make some CLIs wait for more input.
    const input = stdinPath ? fs.openSync(stdinPath, 'r') : null;
    const tampered = [];
    // The child has its own copies once spawned; the runner reads the files by path from then on.
    let open = true;
    const closeFds = () => {
      if (!open) return;
      open = false;
      fs.closeSync(out); fs.closeSync(err); if (input !== null) fs.closeSync(input);
    };
    const closeAll = () => {
      closeFds();
      if (liveOut !== stdoutPath) moveLive(liveOut, stdoutPath, tampered);
      if (liveErr !== stderrPath) moveLive(liveErr, stderrPath, tampered);
    };
    const started = Date.now();
    let timedOut = false;
    let limitHit = false;
    let stopped = null;
    let metered = null;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: [input ?? 'ignore', out, err], detached: true });
    } catch (e) {
      closeAll();
      resolve({ exitCode: null, timedOut: false, wallClockMs: 0, error: e.message, tamperedFiles: tampered });
      return;
    }
    closeFds();
    if (child.pid) procs.trackGroup(child.pid);
    if (child.pid && onSpawn) onSpawn(child.pid);
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { /* already gone */ } };
    const finish = (result) => {
      if (child.pid) procs.untrackGroup(child.pid);
      clearInterval(watcher);
      // Read the final credits before closeAll moves the live stream file.
      const credits = meter ? meter.poll() : null;
      closeAll();
      resolve({ ...result, credits, creditLimitHit: limitHit, stopped, tamperedFiles: tampered });
    };
    // Kills the process group once the credits metered so far pass the limit, or the stop watcher has a decision.
    // The run is then recorded as censored.
    const meter = creditLimit == null ? null : makeCreditMeter(liveOut);
    const watcher = meter || stop ? setInterval(() => {
      if (limitHit || stopped) return;
      if (stop) stopped = stop.poll();
      if (!stopped && (!meter || meter.live() <= creditLimit)) return;
      if (!stopped) { limitHit = true; metered = meter.poll(); }
      kill('SIGTERM');
      setTimeout(() => kill('SIGKILL'), 5000).unref();
    }, stop ? Math.min(creditPollMs, 250) : creditPollMs) : null;
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
        error: limitHit ? `per-run credit limit ${creditLimit} reached at ${metered.toFixed(3)} credits` : signal && !timedOut ? `killed by ${signal}` : null,
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
// A plant run (`plantRun`) also gets its plant dir read-only and only its own socket root, and runs in the cgroup scope when the host has one.
function makeIso(ctx, arm, scratchRoot, task, { offline = false, frozenDirs = [], writableDirs = [], plantRun = null } = {}) {
  const extra = task?.real ? real.hidePaths(task, { cache: ctx.realCache }) : [];
  const iso = makeIsolation({
    mode: ctx.isolation.mode, scratchRoot, writable: writableDirs, hide: [...(ctx.hide || []), ...extra], mask: ctx.mask || [], keyRoots: ctx.keyRoots || [], keep: harnessFor(arm).keepPaths(ctx), frozenDirs, offline,
    ...(plantRun ? plantWalls(ctx.plant, plantRun) : {}),
  });
  return withCgroup(iso, ctx.cgroup);
}

// Reads the stream and the final tree of a real run: fetches made by the agent and verbatim use of the upstream fix.
function auditContamination({ task, arm, ctx, outDir, cwd }) {
  const stream = path.join(outDir, 'stream.jsonl');
  const checked = canAuditFetches(runtimeOf(arm));
  const { events } = checked ? parseStream(fs.existsSync(stream) ? fs.readFileSync(stream, 'utf8') : '') : { events: [] };
  const externalFetch = checked ? scanStream(events, task.realEntry).map((f) => `${f.tool}: ${f.text}`) : null;
  const recall = fixRecall({ baseDir: real.pristineDir(task, { cache: ctx.realCache }), workDir: cwd, patch: real.fixPatchText(task, { cache: ctx.realCache }) });
  const record = { externalFetch, externalFetchChecked: checked, fixRecallChars: recall.matchedChars };
  return { record, flags: contaminationFlags(record) };
}

// Everything that happens after the agent exits. Fills `acc` as it goes so a throw
// part-way keeps what was already computed (spend in particular).
function postProcess({ acc, task, arm, ctx, outDir, runRoot, home, cwd, iso, tripwire, conv = null }) {
  const checkIso = task.real ? makeIso(ctx, arm, runRoot, task, { offline: true }) : iso;
  const harness = harnessFor(arm);
  harness.parseResult(outDir, { home, tmpdir: path.join(runRoot, 'tmp'), acc, arm, ctx, config: ctx.config, freshSessions: Boolean(task.freshSessions) });

  try {
    snapshotWorkspace(cwd, path.join(outDir, 'workspace'));
  } catch {
    acc.meta.flags.push('snapshotFailed');
  }
  if (harness.orchMetrics) {
    try {
      acc.orch = harness.orchMetrics(outDir);
    } catch {
      acc.meta.flags.push('orchMetricsFailed');
    }
  }
  const checkHome = path.join(runRoot, 'check-home');
  fs.mkdirSync(path.join(checkHome, 'tmp'), { recursive: true });
  const { env } = buildCheckEnv(process.env, { home: checkHome, konductor: false });
  // A scripted-user task's hidden tests read the conversation (questions asked, facts matched) from BENCH_CONVERSATION.
  if (task.autonomy?.scripted && conv) {
    const convFile = path.join(runRoot, 'check-scratch', 'conversation.json');
    fs.mkdirSync(path.dirname(convFile), { recursive: true });
    fs.writeFileSync(convFile, JSON.stringify({ questions: conv.questions }));
    env.BENCH_CONVERSATION = convFile;
  }
  // A check may read the agent's final message from BENCH_FINAL_TEXT (D-65: a task whose right answer is to stop and
  // ask checks that the message asks). The file is outside the workspace, so the agent cannot plant it.
  if (typeof acc.agg?.finalText === 'string') {
    const finalFile = path.join(runRoot, 'check-scratch', 'final-text.txt');
    fs.mkdirSync(path.dirname(finalFile), { recursive: true });
    fs.writeFileSync(finalFile, acc.agg.finalText);
    env.BENCH_FINAL_TEXT = finalFile;
  }
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
      const audit = auditContamination({ task, arm, ctx, outDir, cwd });
      acc.meta.contamination = audit.record;
      acc.meta.flags.push(...audit.flags);
    } catch (e) {
      acc.meta.flags.push('contaminationUnchecked');
      acc.meta.contamination = { externalFetch: [], fixRecallChars: 0, error: e.message };
    }
  }
  try {
    harness.collectArtifacts(home, outDir, { arm });
  } catch {
    acc.meta.flags.push('artifactCopyFailed');
  }

  const trip = tripwire.check();
  acc.meta.homeTripwireHits = trip.hits;
  if (trip.note) process.stderr.write(`[bench] tripwire: ${trip.note}\n`);
  acc.meta.flags.push(...tripwireFlags(trip, iso.mode, iso.flaggedInHome));
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

// One session of a fresh-session task, as result.json records it. `stream` is its own stdout file in the out dir.
const sessionEntry = (exec, n, summary) => ({
  session: n, stream: streamFile(true, n), sessionId: summary?.sessionId ?? null, runFinishedStatus: summary?.runFinishedStatus ?? null,
  exitCode: exec.exitCode ?? null, timedOut: Boolean(exec.timedOut), wallClockMs: exec.wallClockMs ?? null,
});

/**
 * Runs the agent: once, or for an autonomy task as a conversation. After a turn that ended cleanly and asked
 * something, the scripted user answers and the same session resumes (same cwd, same scratch HOME, so the credential
 * copy is still there). The task timeout is one budget for all turns. Every turn goes through the same isolation.
 * A task with `freshSessions` runs each of those prompts after the first, once the previous session ended cleanly, as a NEW
 * conversation (no resume) in the same cwd and scratch HOME, so whatever the agent saved in the workspace is still there.
 * Fills `conv` as it goes; returns the combined exec record, with one entry per session in `sessions` for a fresh-session task.
 */
// Kiro CLI records the process that holds a session in HOME/.kiro/session-leases/<id>.lease (its pid). Every turn runs in a
// fresh pid namespace, so the pid turn 1 left can belong to a live process of turn 2 and the resume is refused
// (SessionHeldElsewhereError, pilot wave 3c). Turn 1 has exited before a resume starts, so its lease is stale; drop it.
function dropStaleLease(home, sessionId) {
  if (!home || !/^[A-Za-z0-9_-]+$/.test(String(sessionId ?? ''))) return;
  const dir = path.join(home, '.kiro', 'session-leases');
  for (const f of [`${sessionId}.lease`, `${sessionId}.lease.lock`]) fs.rmSync(path.join(dir, f), { force: true });
}

// One runner rule for fixtures with no repository (DEBT D-161): every new conversation's prompt ends with this line, so an
// agent does not spend turns finding out by running git. Fixture tasks only: a real task and a plant run keep their text.
const NO_GIT_NOTE = 'This folder is not a git repository.';
const withNoGitNote = (t) => ({ ...t, prompt: `${t.prompt}\n\n${NO_GIT_NOTE}` });

async function runTurns({ harness, arm, task, config, ctx, cwd, env, iso, outDir, stdioDir = null, conv, startedAt, plantRun = null, home = null }) {
  const noGit = !task.real && !arm.plant && !fs.existsSync(path.join(cwd, '.git'));
  const fresh = task.freshSessions ?? [];
  const multi = Boolean(task.autonomy) || fresh.length > 0;
  const deadline = Date.now() + task.timeoutSec * 1000;
  const execs = [];
  let resume = null;
  let sessionId = null;
  let turn = 0;
  let spent = 0;
  // Credits that only arrive when a turn ends (engine v3) can be checked here, so the next turn is not started.
  const overLimitAfter = (exec) => {
    if (ctx.runCreditLimit == null || spent <= ctx.runCreditLimit) return false;
    exec.creditLimitHit = true;
    exec.error = `per-run credit limit ${ctx.runCreditLimit} reached at ${spent.toFixed(3)} credits (checked when turn ${turn} ended; no further turn was started)`;
    return true;
  };
  try {
    for (;;) {
      turn++;
      const remaining = deadline - Date.now();
      if (turn > 1 && remaining <= 0) {
        execs.push({ exitCode: null, timedOut: true, wallClockMs: 0, error: null });
        break;
      }
      const asked = fresh.length && turn > 1 ? { ...task, prompt: fresh[turn - 2].prompt } : task;
      const turnTask = noGit ? withNoGitNote(asked) : asked;
      if (resume) dropStaleLease(home, resume.sessionId);
      const cmd = harness.buildCommand({ arm, task: turnTask, config, ctx, cwd, resume, home });
      if (turn === 1) {
        fs.writeFileSync(path.join(outDir, 'command.txt'), `${cmd.display}\n(cwd=<fresh copy of ${task.real ? `real task ${task.real}` : `fixture ${task.fixture}`}>, isolation=${iso.mode})\n`);
      } else {
        fs.appendFileSync(path.join(outDir, 'command.txt'), `--- turn ${turn} (${resume ? 'resumed' : 'fresh session, same workspace'}) ---\n${cmd.display}\n`);
      }
      const w = iso.wrap(cmd.file, cmd.args);
      // A harness that takes its prompt on stdin keeps it out of argv; the runner opens the file, so the mask on outDir does not matter.
      const stdinPath = typeof cmd.stdin === 'string' ? path.join(outDir, multi ? `prompt-${turn}.txt` : 'prompt.txt') : null;
      if (stdinPath) fs.writeFileSync(stdinPath, cmd.stdin);
      const stdoutPath = path.join(outDir, streamFile(multi, turn));
      // The stop watcher reads the stream while the child runs, so it follows the live file.
      const benchStop = ctx.stopOn || ctx.maxToolCalls ? makeStopWatcher(liveStdioPath(stdoutPath, stdioDir), { runtime: harness.id, stopOn: ctx.stopOn ?? 'end_turn', maxToolCalls: ctx.maxToolCalls ?? null }) : null;
      const stop = plantRun ? plantRun.watcher(benchStop) : benchStop;
      const exec = await spawnWithTimeout(w.file, w.args, {
        cwd, env, timeoutMs: Math.max(1, remaining),
        stdoutPath, stderrPath: path.join(outDir, stderrFile(multi, turn)), stdinPath, stdioDir,
        creditLimit: ctx.runCreditLimit == null ? null : Math.max(0, ctx.runCreditLimit - spent), creditPollMs: ctx.creditPollMs, stop,
        onSpawn: plantRun ? (pid) => plantRun.onSpawn(pid) : null,
      });
      spent += exec.credits ?? 0;
      if (exec.stopped?.reason === 'end_turn') {
        // The turn was complete; only leftover processes were stopped.
        exec.exitCode = 0;
        exec.error = null;
      } else if (exec.stopped) {
        exec.error = `stopped early: ${exec.stopped.reason} (${exec.stopped.detail})`;
      }
      if (exec.creditLimitHit) exec.error = `per-run credit limit ${ctx.runCreditLimit} reached at ${spent.toFixed(3)} credits`;
      execs.push(exec);
      if (exec.creditLimitHit || (exec.stopped && exec.stopped.reason !== 'end_turn')) break;
      if (!multi) break;
      const clean = exec.exitCode === 0 && !exec.timedOut && !exec.error;
      const summary = clean ? harness.turnSummary(readIfPresent(path.join(outDir, streamFile(multi, turn)))) : null;
      const finished = summary && summary.runFinishedStatus === 'success' ? summary : null;
      if (fresh.length) {
        exec.session = sessionEntry(exec, turn, summary);
        // A session that did not finish cleanly ends the task: the next one would start from a half-written state.
        if (!finished || turn > fresh.length || overLimitAfter(exec)) break;
        continue; // resume stays null: the next prompt opens a new conversation
      }
      const reply = conv.record(finished);
      if (!reply) break;
      if (overLimitAfter(exec)) break;
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
    creditLimitHit: execs.some((e) => e.creditLimitHit),
    ...(ctx.runCreditLimit == null ? {} : { creditLimit: ctx.runCreditLimit, creditOvershoot: spent > ctx.runCreditLimit ? spent - ctx.runCreditLimit : null }),
    stopped: execs.map((e) => e.stopped).find((x) => x && x.reason !== 'end_turn') ?? null,
    tamperedFiles: execs.flatMap((e) => e.tamperedFiles ?? []),
    wallClockMs: execs.reduce((n, e) => n + (e.wallClockMs ?? 0), 0),
    error: last.error ?? null,
    startedAt,
    ...(fresh.length ? { sessions: execs.map((e, i) => e.session ?? sessionEntry(e, i + 1, null)), sessionsPlanned: fresh.length + 1 } : {}),
  };
}

// A change to the real installs directory invalidates the run, whatever the agent reported. The spend stays recorded.
function failOnLeak(result, leak) {
  const msg = describeChange(leak);
  result.flags = [...new Set([...(result.flags || []), 'installsChanged'])];
  result.infraError = [result.infraError, msg].filter(Boolean).join(' | ');
  result.error = [result.error, msg].filter(Boolean).join(' | ');
  result.status = 'error';
}

// The scrub of the run's output files. A harness may return a bare count (nothing left unscrubbed) or {scrubbed, unscrubbed}.
// A throw is recorded as an unscrubbed output directory: a run whose scrub did not finish must not be judged.
// `reason` is one of hygiene.SCRUB_CAUSES; free text from a harness that does not classify becomes 'error' with the text as detail.
function unscrubbedEntry(outDir, u) {
  const known = SCRUB_CAUSES.includes(u.reason);
  const detail = known ? u.detail : u.detail ?? u.reason;
  return { file: path.relative(outDir, u.file) || '.', reason: known ? u.reason : 'error', ...(detail === undefined ? {} : { detail: String(detail) }) };
}

function finalizeOutput(harness, outDir, ctx) {
  try {
    const r = harness.finalize(outDir, ctx);
    if (typeof r === 'number') return { scrubbed: r, unscrubbed: [] };
    return { scrubbed: r?.scrubbed ?? 0, unscrubbed: (r?.unscrubbed ?? []).map((u) => unscrubbedEntry(outDir, u)) };
  } catch (e) {
    return { scrubbed: 0, unscrubbed: [{ file: '.', reason: 'error', detail: `scrub failed: ${e.message}` }] };
  }
}

async function executeRun({ arm, task, replicate, ctx, prepared, outDir, inFlightAtStart = null }) {
  const { config } = ctx;
  const harness = harnessFor(arm);
  const base = { arm, task, replicate, config, env: ctx.envInfo };
  const meta = { flags: [], isolation: ctx.isolation.mode, inFlightAtStart, mcpSha256: prepared?.mcpSha256 ?? null, agentStarted: false };
  let result;
  let runRoot = null;
  let stdioDir = null;
  let home = null;
  let plantRun = null;
  let probeDirs = [];
  const installsWindow = ctx.installsGate ? ctx.installsGate.begin() : null;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    runRoot = fs.mkdtempSync(path.join(ctx.scratchDir, 'r-'));
    stdioDir = liveStdioDir(ctx.isolation.mode, runRoot);
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
      ctx.taskInputs?.check(task);
      if (task.real) real.materializeInto(task, cwd, { cache: ctx.realCache });
      else sandbox.copyFixture(task.fixtureDir, cwd);
      const leaked = sandbox.findAnswerKey(cwd);
      if (leaked) throw new Error(`answer key present in the agent working directory: ${leaked}`);
      // What the agent starts with (agent, MCP servers, steering, skills, links into the real ~/.kiro or ~/.claude).
      fs.writeFileSync(path.join(outDir, 'startup.json'), `${JSON.stringify(startupRecord({ runtime: harness.id, arm, home, cwd, strictMcp: Boolean(harness.strictMcp) }), null, 2)}\n`);
      fs.mkdirSync(path.join(runRoot, 'tmp'), { recursive: true });
      if (stdioDir) fs.mkdirSync(stdioDir, { mode: 0o700 });
      if (arm.plant) plantRun = await openPlantRun({ suite: ctx.plant, arm, task, runRoot, home, cwd, outDir });
    } catch (e) {
      meta.infraError = e.message;
      result = errorResult({ ...base, message: `setup failed: ${e.message}`, meta });
    }

    if (!result) {
      // The kiro-cli dumps go next to the run root, out of the agent's working directory and HOME; the isolation keeps
      // that directory writable for the engine.
      try {
        if (ctx.introspect) probeDirs = introspect.probeWritableDirs({ harnessId: harness.id, runRoot });
      } catch (e) {
        meta.infraError = `cannot create the introspect dump directory: ${e.message}`;
        result = errorResult({ ...base, message: meta.infraError, meta });
      }
    }

    if (!result) {
      const iso = makeIso(ctx, arm, runRoot, task, { frozenDirs: stdioDir ? [stdioDir] : [], writableDirs: probeDirs, plantRun });
      const tripwire = createTripwire({ markerPath: path.join(runRoot, '.marker'), ...ctx.tripwire });
      let probe = null;
      try {
        const tmpdir = path.join(runRoot, 'tmp');
        let env = harness.env({ arm, config, ctx, home, tmpdir });
        if (ctx.introspect) {
          probe = await introspect.startProbe({ harnessId: harness.id, outDir, runRoot, home, dumpRoot: probeDirs[0] ?? null, deps: ctx.introspectDeps ?? {} });
          env = probe.apply(env);
        }
        tripwire.start();
        if (plantRun?.startError) exec = plantRun.unstartedExec();
        else {
          meta.agentStarted = true;
          exec = await runTurns({ harness, arm, task, config, ctx, cwd, env, iso, outDir, stdioDir, conv, startedAt: new Date().toISOString(), plantRun, home });
        }
      } catch (e) {
        meta.infraError = e.message;
        exec = { timedOut: false, exitCode: null, wallClockMs: null, error: e.message };
      }
      if (plantRun) await plantRun.finish();
      harness.removeCredentials(home);
      if (probe) {
        meta.flags.push('introspect');
        try { await probe.afterExit(); } catch (e) { meta.flags.push('introspectFailed'); process.stderr.write(`[bench] introspect: ${e.message}\n`); }
      }
      if (exec?.tamperedFiles?.length) {
        meta.flags.push('stdioTampered');
        meta.tamperedFiles = exec.tamperedFiles;
        meta.infraError = [meta.infraError, `live output replaced by the agent, not moved: ${exec.tamperedFiles.join(', ')}`].filter(Boolean).join(' | ');
      }

      if (fs.existsSync(path.join(outDir, 'stream.jsonl'))) {
        try {
          postProcess({ acc, task, arm, ctx, outDir, runRoot, home, cwd, iso, tripwire, conv });
        } catch (e) {
          meta.infraError = [meta.infraError, `post-processing failed: ${e.message}`].filter(Boolean).join(' | ');
        }
      }
      const authFailure = exec ? classifyAuthFailure({ agg: acc.agg, exec, texts: [readIfPresent(path.join(outDir, 'stderr.txt')), readIfPresent(path.join(outDir, 'stream.jsonl'))] }) : null;
      if (authFailure) {
        meta.authFailure = authFailure;
        meta.infraError = [meta.infraError, `login not valid, no turn ran: ${authFailure}`].filter(Boolean).join(' | ');
      }
      const launchFailure = exec && !authFailure ? classifyLaunchFailure({ agg: acc.agg, exec, texts: [readIfPresent(path.join(outDir, 'stderr.txt'))] }) : null;
      if (launchFailure) {
        meta.launchFailure = launchFailure;
        meta.infraError = [meta.infraError, `agent binary could not be launched, no turn ran: ${launchFailure}`].filter(Boolean).join(' | ');
      }
      if (exec?.creditLimitHit) meta.flags.push('creditLimit');
      else if (exec?.creditOvershoot > 0) meta.flags.push('creditLimitExceeded');
      if (exec?.creditLimit != null) { meta.creditLimit = exec.creditLimit; meta.creditOvershoot = exec.creditOvershoot ?? null; }
      if (exec?.stopped) meta.flags.push('earlyStopped');
      plantRun?.scoreInto(meta, { agg: acc.agg, exec, outDir });
      if (harness.finalize) {
        const fin = finalizeOutput(harness, outDir, ctx);
        if (fin.scrubbed > 0) meta.flags.push('credsRedacted');
        if (fin.unscrubbed.length) {
          meta.flags.push('credsUnscrubbed');
          meta.unscrubbed = fin.unscrubbed;
        }
      }
      plantRun?.rescoreAfterScrub(meta);
      result = buildResult({ ...base, exec, agg: acc.agg, session: acc.session, usage: acc.usage ?? null, skills: acc.skills ?? null, orch: acc.orch ?? null, checks: acc.checks, transcript: acc.transcript, meta, conv });
    }
  }

  if (runRoot) {
    plantRun?.dispose();
    if (home) harness.removeCredentials(home);
    if (harness.cleanupRun) {
      const tmpdir = path.join(runRoot, 'tmp');
      const removed = harness.cleanupRun({ cwd: path.join(runRoot, 'work'), tmpdir, tmpBases: ctx.claudeTmpBases });
      if (result.claudeCode) result.claudeCode = { ...result.claudeCode, tmpCleanup: harness.describeCleanup(removed, tmpdir) };
    }
    fs.rmSync(runRoot, { recursive: true, force: true });
    if (stdioDir) fs.rmSync(stdioDir, { recursive: true, force: true });
    for (const d of probeDirs) fs.rmSync(d, { recursive: true, force: true });
  }
  const listing = ctx.skillListings?.get(arm.id);
  if (listing) {
    result.skillListing = listing.listing;
    if (harness.id === 'claude-code') result.claudeCode = { ...(result.claudeCode ?? {}), skillListing: listing.listing };
  }
  const scrubbed = scrubDeep(result, secretLiterals(process.env, harness.secrets ? harness.secrets(ctx) : []));
  result = scrubbed.value;
  if (scrubbed.count) result.flags = [...new Set([...(result.flags || []), 'credsRedacted'])];
  const leak = installsWindow ? installsWindow.end() : null;
  if (leak && !leak.ok) failOnLeak(result, leak);
  const problems = validateResult(result);
  if (problems.length) result.error = [result.error, `schema: ${problems.join('; ')}`].filter(Boolean).join(' | ');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    writeAtomic(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  } catch { /* the caller still gets the result object */ }
  if (ctx.introspect) {
    try { introspectReport.writeReport(outDir); } catch (e) { process.stderr.write(`[bench] introspect report: ${e.message}\n`); }
  }
  return result;
}

module.exports = { NO_GIT_NOTE,
  dropStaleLease, executeRun, auditContamination, makeIso, kiroArgs: kiro.kiroArgs, spawnWithTimeout, readTranscripts: kiro.readTranscripts };
