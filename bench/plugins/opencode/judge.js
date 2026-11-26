// SPDX-License-Identifier: Apache-2.0
// The opencode judge backend: one `opencode run` per judge call on Amazon Bedrock, tools off, a one-line system prompt.
// A `judge-backend` part of this plugin (judge-meta.js, B-014). The core calls `makeCaller`, and when a part exports
// them, `cacheSalt(model)` for the cache key and `checkJudges(judges)` before any call.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const sdk = require('../../sdk');
const oc = require('./harness.js');
const { aggregateEvents, rollUp, SQL } = require('./parse.js');
const { installCredentials, removeCredentials, readProfile } = require('./creds.js');
const { id: OPENCODE_BACKEND } = require('./judge-meta.js');

const { parseStream } = sdk.stream;
const { spawnWithTimeout } = sdk.runOne;
const { sandbox, procs } = sdk;
const { writeCredentials, makeExportedCredentials, awsExport, isProfileName } = sdk.awsCreds;
const { JUDGE_SYSTEM_PROMPT, systemPromptSha256 } = sdk.judgePrompt;

// The read judge view (bench/judge/view/read.js): the only tools, the step cap, and what a read call adds to the env.
const READ_TOOLS = Object.freeze(['read', 'glob', 'grep']);
const READ_STEPS = 40;
const READ_ENV = Object.freeze({ OPENCODE_DISABLE_EXTERNAL_SKILLS: '1' });

// Panel ids stay the logical names used everywhere else (family checks run on them). `temperature: null` means the
// model rejects the field on Bedrock, so the no-temperature agent is used and nothing is sent.
// `limit` is opencode's context and output cap for the model; the output cap is far above the longest reply seen. The
// context caps of minimax-m2.5 (196K) and qwen3-coder-next (256K) are their Bedrock model cards.
const OPENCODE_MODELS = {
  'gpt-5.6-luna': { bedrockId: 'global.openai.gpt-5.6-luna', temperature: null, limit: { context: 900000, output: 8000 } },
  'deepseek-3.2': { bedrockId: 'deepseek.v3.2', temperature: 0, limit: { context: 160000, output: 8000 } },
  'glm-5': { bedrockId: 'zai.glm-5', temperature: 0, limit: { context: 200000, output: 8000 } },
  'qwen3-coder-next': { bedrockId: 'qwen.qwen3-coder-next', temperature: 0, limit: { context: 256000, output: 8000 } },
  'minimax-m2.5': { bedrockId: 'minimax.minimax-m2.5', temperature: 0, limit: { context: 196000, output: 8000 } },
};

const known = () => Object.keys(OPENCODE_MODELS).join(', ');

/** The Bedrock model, agent and temperature of a logical panel id. Throws on an id with no mapping. */
function opencodeModel(logical) {
  const m = OPENCODE_MODELS[logical];
  if (!m) throw new Error(`no Bedrock mapping for judge "${logical}" on the opencode backend (known panel ids: ${known()})`);
  return { logical, ...m, agent: m.temperature === null ? 'judge-notemp' : 'judge' };
}

/**
 * Throws unless every judge is a mapped panel id. A raw Bedrock id would pass the family check under another family
 * name (zai.glm-5 is "zai", glm-5 is "glm"), so it is refused with the panel id to use.
 */
function checkJudges(judges) {
  for (const j of judges) {
    const logical = Object.keys(OPENCODE_MODELS).find((k) => OPENCODE_MODELS[k].bedrockId === j);
    if (logical) throw new Error(`judge "${j}" is a Bedrock model id; use the panel id "${logical}" (the backend maps it)`);
    opencodeModel(j);
  }
}

// A caller is async ({model, prompt}) => {text, credits, usd, tokens, latencyMs, error?}. `model` is the logical panel id.

const THROTTLE = new RegExp(`${oc.THROTTLE.source}|ServiceUnavailable|ModelNotReady|ModelTimeout`, 'i');
const AUTH = /ExpiredToken|UnrecognizedClient|InvalidSignature|AccessDenied|InvalidClientTokenId|security token|credentials? (?:are|is) (?:invalid|expired)|Could not load credentials/i;

// opencode reads these in config/config.ts; with the config's `compaction` block they keep the judge from summarizing.
const NO_COMPACTION_ENV = Object.freeze({ OPENCODE_DISABLE_AUTOCOMPACT: '1', OPENCODE_DISABLE_PRUNE: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1' });

const sha12 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const clip = (text, n = 300) => String(text).trim().replace(/\s+/g, ' ').slice(-n);

// One model, one agent. The built-in agents are switched off so the judge agent is the only one that can run.
// Compaction and pruning are off: a judge must grade what it was sent, never opencode's own summary of it.
// With `read`, the agent may use read, glob and grep and nothing else: opencode applies the last matching permission
// rule (findLast in permission/index.ts), so "*" deny comes first; external_directory deny keeps every path inside --dir.
function configJson(m, { region, profile }, { read = false } = {}) {
  const agent = { mode: 'primary', description: 'bare evaluator', prompt: JUDGE_SYSTEM_PROMPT, tools: { '*': false }, permission: { '*': 'deny' } };
  if (read) {
    agent.tools = { '*': false, ...Object.fromEntries(READ_TOOLS.map((t) => [t, true])) };
    agent.permission = { '*': 'deny', ...Object.fromEntries(READ_TOOLS.map((t) => [t, 'allow'])), external_directory: 'deny' };
    agent.steps = READ_STEPS;
  }
  if (m.temperature !== null) agent.temperature = m.temperature;
  return {
    $schema: 'https://opencode.ai/config.json', share: 'disabled', snapshot: false, autoupdate: false, enabled_providers: [oc.PROVIDER], compaction: { auto: false, prune: false },
    provider: { [oc.PROVIDER]: { options: { region, profile }, models: { [m.bedrockId]: { name: m.bedrockId, limit: m.limit, temperature: m.temperature !== null } } } },
    agent: { ...Object.fromEntries(oc.BUILTIN_AGENTS.map((n) => [n, { disable: true }])), [m.agent]: agent },
  };
}

// Runs one read-only query on the call's own database. Each `opencode db` start costs about a second, so a call makes
// two: the session rows (the rollup needs nothing else) and the compaction check.
function runDb(bin, env, sql) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['db', sql, '--format', 'json'], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
    child.stdin.end();
  });
}

// Part of the cache key: an answer is reused only for the same system prompt, Bedrock model and temperature setting.
function cacheSaltOf(model) {
  const m = opencodeModel(model);
  return `opencode\n${systemPromptSha256()}\n${m.bedrockId}\n${m.temperature === null ? 'no-temperature' : `temperature-${m.temperature}`}`;
}

// Credentials come from a shared-credentials file (read again for every call, so a file rewritten in place is picked up), or
// from `credentials`, a provider made by makeExportedCredentials (runner/lib/aws-creds.js) that refreshes them itself. After
// `maxAuthFailures` calls in a row whose credentials Bedrock rejected, the caller stops: `stopReason()` says why, and every
// later call returns that error without starting opencode, so the pass ends instead of spending its remaining calls on errors.
//
// `isolation` ({ mode, hide, reason }) is the OS isolation a read-view call runs under; `isolate` builds it (the bench's
// makeIsolation). A read call is refused unless the mode is unshare or sandbox-exec; the credentials file and `hide` are
// hidden on top of the home's credential paths. Calls without a read copy never use it.
function makeOpencodeCaller({
  bin, credsFile = null, credentials = null, awsProfile = 'bench', region = 'us-east-1', timeoutMs, version = null, sha256 = null, scratchRoot = os.tmpdir(), rawDir = null,
  maxAttempts = 6, backoffMs = 2000, maxBackoffMs = 60000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxAuthFailures = 3,
  isolation = { mode: 'none' }, isolate = sdk.isolate.makeIsolation,
}) {
  const isolated = isolation.mode === 'unshare' || isolation.mode === 'sandbox-exec';
  const noIsolation = () => isolation.reason ?? `isolation mode ${isolation.mode}`;
  if (Boolean(credsFile) === Boolean(credentials)) throw new Error('the opencode judge caller takes a credentials file or a credentials provider, not both or neither');
  const firstSecrets = credsFile ? readProfile(credsFile, awsProfile).secrets : [];
  // A file rewritten during the pass holds new values, so both the first and the current ones are scrubbed.
  const fileSecrets = () => { try { return [...firstSecrets, ...readProfile(credsFile, awsProfile).secrets]; } catch { return firstSecrets; } };
  const secrets = () => (credentials ? credentials.secrets() : fileSecrets());
  const opencodeVersion = version ?? sandbox.versionOf(bin);
  const scrub = (text) => secrets().filter((s) => s && s.length >= 4).reduce((t, s) => t.split(s).join('<redacted>'), String(text)).replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '<redacted>');
  let authFailures = 0;
  let stopped = null;

  function keepRaw(model, prompt, outPath, errPath) {
    if (!rawDir) return;
    try {
      fs.mkdirSync(rawDir, { recursive: true });
      const stem = path.join(rawDir, `${model.replace(/[^\w.-]/g, '_')}-${sha12(`${model}\n${prompt}`)}-${Date.now()}`);
      fs.writeFileSync(`${stem}.jsonl`, scrub(fs.readFileSync(outPath, 'utf8')));
      if (fs.statSync(errPath).size) fs.writeFileSync(`${stem}.stderr.txt`, scrub(fs.readFileSync(errPath, 'utf8')));
    } catch { /* auditing must not fail the judge call */ }
  }

  // One try, in its own scratch HOME. Returns {text, ...usage} or {error, throttled?}. With `readCopy` ({ files, sha }),
  // the files are written to the working folder and the call runs as a read-view call (READ_TOOLS, under isolation).
  async function attempt(m, model, prompt, readCopy = null) {
    if (readCopy && !isolated) return { text: '', credits: 0, latencyMs: 0, error: `the read judge view needs OS isolation with the credentials file hidden (--isolate unshare or sandbox-exec); this caller has none: ${noIsolation()}` };
    const root = fs.mkdtempSync(path.join(scratchRoot, 'jdg-oc-'));
    procs.trackScratch(root);
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'cwd');
    const tmpdir = path.join(root, 'tmp');
    for (const d of [path.join(home, oc.CONFIG_REL), cwd, tmpdir]) fs.mkdirSync(d, { recursive: true });
    const promptPath = path.join(root, 'prompt.txt');
    const outPath = path.join(root, 'stdout.jsonl');
    const errPath = path.join(root, 'stderr.txt');
    try {
      if (readCopy) {
        const above = sdk.judgeReadCopy.instructionFilesAbove(cwd);
        if (above.length) return { text: '', credits: 0, latencyMs: 0, error: `the read judge view refused: an instruction file above the copy would be attached to every read (${above.join(', ')}); use a scratch root with none above it` };
        sdk.judgeReadCopy.writeCopy(cwd, readCopy.files);
      }
      fs.writeFileSync(path.join(home, oc.CONFIG_REL, 'opencode.json'), `${JSON.stringify(configJson(m, { region, profile: awsProfile }, { read: Boolean(readCopy) }), null, 2)}\n`);
      if (credentials) {
        let creds;
        try { creds = await credentials.current(); } catch (e) { return { text: '', credits: 0, latencyMs: 0, error: `no usable AWS credentials: ${scrub(e.message)}`, auth: true }; }
        writeCredentials({ home, profile: awsProfile, region, creds });
      } else installCredentials({ credsFile, profile: awsProfile, home, region });
      fs.writeFileSync(promptPath, prompt);
      const { env } = oc.envSetup({ arm: { vanilla: true }, config: {}, ctx: { awsProfile }, home, tmpdir });
      env.AWS_REGION = region;
      env.AWS_DEFAULT_REGION = region;
      Object.assign(env, NO_COMPACTION_ENV, readCopy ? READ_ENV : {});
      const args = ['run', '--dir', cwd, '--agent', m.agent, '-m', `${oc.PROVIDER}/${m.bedrockId}`, '--format', 'json', '--title', oc.TITLE];
      let w = { file: bin, args };
      if (readCopy) {
        if (env.OPENCODE_DISABLE_PROJECT_CONFIG !== '1') return { text: '', credits: 0, latencyMs: 0, error: 'the read judge view needs OPENCODE_DISABLE_PROJECT_CONFIG=1 in the judge env' };
        const hide = [...(isolation.hide || []), ...(credsFile ? [credsFile] : [])];
        w = isolate({ mode: isolation.mode, scratchRoot: root, hide, keep: [bin] }).wrap(bin, args);
      }
      const exec = await spawnWithTimeout(w.file, w.args, { cwd, env, timeoutMs, stdoutPath: outPath, stderrPath: errPath, stdinPath: promptPath });
      keepRaw(model, prompt, outPath, errPath);
      const base = { text: '', credits: 0, latencyMs: exec.wallClockMs, bedrockModelId: m.bedrockId };
      if (exec.timedOut) return { ...base, error: `timed out after ${timeoutMs} ms` };
      if (exec.error && exec.exitCode === null) return { ...base, error: `opencode failed: ${scrub(exec.error)}` };
      const { events } = parseStream(fs.readFileSync(outPath, 'utf8'));
      const a = aggregateEvents(events);
      const stderr = scrub(fs.readFileSync(errPath, 'utf8'));
      const failure = scrub([...a.errors, stderr].join('\n'));
      const others = Object.keys(a.toolNames).filter((t) => !readCopy || !READ_TOOLS.includes(t));
      if (readCopy && others.length) return { ...base, error: `the judge agent used a tool other than ${READ_TOOLS.join(', ').replace(/, (?=[^,]*$)/, ' and ')} (${others.join(', ')})` };
      if (!readCopy && a.toolCalls) return { ...base, error: `the judge agent used a tool (${Object.keys(a.toolNames).join(', ')}); tools must stay off` };
      if (a.errors.length || exec.exitCode !== 0 || a.runFinishedStatus !== 'success' || !a.finalText) {
        if (AUTH.test(failure)) return { ...base, error: `Bedrock credentials were rejected: ${clip(failure)}` };
        if (THROTTLE.test(failure)) return { ...base, throttled: true, error: clip(failure) };
        if (exec.exitCode === 0 && !a.errors.length && !a.steps && !stderr.trim()) return { ...base, error: 'opencode returned no reply' };
        return { ...base, error: `opencode exit ${exec.exitCode}${clip(failure) ? `: ${clip(failure)}` : ''}` };
      }
      // Compaction is off, so a summary means the guard failed: the reply would grade a summary. The db check is the proof;
      // a db that cannot be read proves nothing, so the call is not scored. More than one step with tools off is the stream signal.
      if (!readCopy && a.steps > 1) return { ...base, error: `compacted: ${a.steps} model steps in a tools-off call` };
      let compacted;
      try { [compacted] = await runDb(bin, env, SQL.compaction); } catch (e) { return { ...base, error: `could not check the call's database for compaction: ${clip(scrub(e.message))}` }; }
      if (!compacted || compacted.messages > 0 || compacted.parts > 0) return { ...base, error: `compacted: the call's database holds ${compacted?.messages ?? '?'} summary message(s) and ${compacted?.parts ?? '?'} compaction part(s)` };
      let usage = { tokens: a.steps ? { ...a.tokens } : null, usd: a.steps ? a.costUsd : null, usageSource: a.steps ? 'stream' : null };
      try {
        const rolled = rollUp({ sessions: await runDb(bin, env, SQL.sessions), messages: [], tools: [] }, a.sessionId);
        if (rolled) {
          if (rolled.rootModel && rolled.rootModel !== m.bedrockId) return { ...base, error: `opencode served model "${rolled.rootModel}", expected "${m.bedrockId}"` };
          usage = { tokens: rolled.tokens, usd: rolled.costUsd, usageSource: 'db' };
        }
      } catch { /* the stream totals stay */ }
      return { ...base, text: a.finalText, ...usage, ...(readCopy ? { readTrace: readTraceOf(events, cwd, a.steps) } : {}) };
    } finally {
      removeCredentials(home);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      procs.untrackScratch(root);
    }
  }

  const caller = async ({ model, prompt, readCopy = null }) => {
    if (stopped) return { text: '', credits: 0, latencyMs: 0, error: stopped };
    let m;
    try { m = opencodeModel(model); } catch (e) { return { text: '', credits: 0, latencyMs: 0, error: e.message }; }
    let retries = 0;
    let throttled = 0;
    let latencyMs = 0;
    let last = null;
    for (let i = 0; i < maxAttempts; i++) {
      last = await attempt(m, model, prompt, readCopy);
      latencyMs += last.latencyMs ?? 0;
      if (!last.throttled) break;
      throttled++;
      if (i === maxAttempts - 1) break;
      retries++;
      await sleep(Math.min(maxBackoffMs, backoffMs * 2 ** i));
    }
    const { throttled: wasThrottled, auth, ...result } = last;
    if (wasThrottled) result.error = `throttled by Bedrock after ${maxAttempts} attempts: ${result.error}`;
    if (auth || /^Bedrock credentials were rejected/.test(result.error ?? '')) {
      authFailures++;
      if (authFailures >= maxAuthFailures && !stopped) stopped = `judging stopped: ${authFailures} calls in a row failed on their AWS credentials (last: ${result.error})`;
    } else if (!result.error) authFailures = 0;
    return { ...result, latencyMs, retries, throttled };
  };
  caller.stopReason = () => stopped;
  // What a judge view may need from this caller at run time (bench/judge/view/index.js checkViewCaller).
  caller.offers = () => (isolated ? ['isolation'] : []);
  caller.why = () => (isolated ? null : noIsolation());

  caller.info = {
    backend: OPENCODE_BACKEND, opencodeVersion, binarySha256: sha256, region, awsProfile, systemPrompt: JUDGE_SYSTEM_PROMPT, systemPromptSha256: systemPromptSha256(),
    models: (judges) => Object.fromEntries(judges.map((j) => {
      const m = opencodeModel(j);
      return [j, { bedrockModelId: m.bedrockId, agent: m.agent, temperature: m.temperature, temperatureApplied: m.temperature !== null }];
    })),
  };
  caller.cacheSalt = cacheSaltOf;
  return caller;
}

// The tool calls of a read-view call, for the view's audit: each tool's name, input (filePath, offset, limit, path,
// pattern) and status, with the working folder as given and as its real path (a judge may use either).
function readTraceOf(events, cwd, steps) {
  const tools = events.filter((e) => e.type === 'tool_use').map((e) => ({ tool: e.part?.tool ?? 'unknown', input: e.part?.state?.input ?? {}, status: e.part?.state?.status ?? null }));
  let real = cwd;
  try { real = fs.realpathSync(cwd); } catch { /* the given path stays */ }
  return { dirs: [...new Set([cwd, real])], steps, tools };
}

/**
 * The OS isolation read-view calls run under, from the judge command's --isolate (default auto) and --hide plus
 * BENCH_HIDE_EXTRA. It never throws: when isolation cannot start here, the mode is none and `reason` says why, so the
 * bundle view still judges and the read view is refused with that reason.
 */
function judgeIsolation(flags) {
  const requested = flagValue(flags, 'isolate') ?? 'auto';
  const hide = [...String(flagValue(flags, 'hide') ?? '').split(','), ...String(process.env.BENCH_HIDE_EXTRA || '').split(',')].filter(Boolean);
  if (requested === 'none') return { mode: 'none', hide, reason: 'isolation is off (--isolate none)' };
  try {
    const r = sdk.isolate.resolveIsolation(requested);
    return { mode: r.mode, hide, reason: r.reason };
  } catch (e) { return { mode: 'none', hide, reason: e.message }; }
}

const flagValue = (flags, name) => (flags[name] !== undefined && flags[name] !== true ? String(flags[name]) : null);

/**
 * The judge command's caller (core `makeBackendCaller`). `flags` are the judge command's own options: credentials
 * from a shared-credentials file (--aws-creds-file) or from `aws configure export-credentials` (--aws-export-profile),
 * refreshed during the pass; BENCH_AWS_BIN points the export at another aws binary (tests use a fake one).
 * --aws-profile, --aws-region, --opencode-bin and --cache pick the profile, region, binary and install cache.
 * `log` gets one line naming the binary version, region and system prompt hash.
 */
function makeCaller({ timeoutMs, rawDir = null, log = () => {}, flags = {} }) {
  const exportProfile = flagValue(flags, 'aws-export-profile');
  if (exportProfile && flags['aws-creds-file'] !== undefined) throw new Error('--aws-creds-file and --aws-export-profile cannot be used together');
  if (exportProfile && !isProfileName(exportProfile)) throw new Error(`--aws-export-profile "${exportProfile}" is not a profile name`);
  const credsFlag = flagValue(flags, 'aws-creds-file');
  if (!exportProfile && !credsFlag) throw new Error('--aws-creds-file is required');
  const credsFile = exportProfile ? null : path.resolve(credsFlag);
  const awsProfile = flagValue(flags, 'aws-profile') ?? 'bench';
  const region = flagValue(flags, 'aws-region') ?? oc.REGION;
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error(`--aws-region "${region}" is not an AWS region name`);
  if (credsFile) readProfile(credsFile, awsProfile);
  const awsBin = process.env.BENCH_AWS_BIN || 'aws';
  const credentials = exportProfile ? makeExportedCredentials({ profile: exportProfile, exporter: (p) => awsExport(p, { awsBin }), log }) : null;
  const cacheDir = path.resolve(flagValue(flags, 'cache') ?? path.join(os.tmpdir(), 'b-cache'));
  const resolved = oc.resolveOpencode({ cacheDir, binOverride: flagValue(flags, 'opencode-bin') });
  const isolation = judgeIsolation(flags);
  const caller = makeOpencodeCaller({ bin: resolved.bin, version: resolved.version, sha256: resolved.sha256, credsFile, credentials, awsProfile, region, timeoutMs, rawDir, isolation });
  log(`read view isolation: ${isolation.mode} (${isolation.reason})`);
  log(`backend: opencode ${caller.info.opencodeVersion}, ${caller.info.region}, system prompt sha256 ${caller.info.systemPromptSha256.slice(0, 12)}`);
  return caller;
}

module.exports = {
  makeCaller, cacheSalt: cacheSaltOf, checkJudges, makeOpencodeCaller, configJson, OPENCODE_MODELS, opencodeModel, REGION: oc.REGION,
};
