// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { parseStream } = require('../runner/lib/stream.js');
const { spawnWithTimeout } = require('../runner/lib/run-one.js');
const sandbox = require('../runner/lib/sandbox.js');
const procs = require('../runner/lib/procs.js');
const oc = require('../runner/lib/harness/opencode.js');
const { aggregateEvents, rollUp, SQL } = require('../runner/lib/harness/opencode-parse.js');
const { installCredentials, removeCredentials, readProfile } = require('../runner/lib/harness/opencode-creds.js');
const { JUDGE_SYSTEM_PROMPT, systemPromptSha256, opencodeModel } = require('./backends.js');

// A caller is async ({model, prompt}) => {text, credits, usd, tokens, latencyMs, error?}. `model` is the logical panel id.

const THROTTLE = new RegExp(`${oc.THROTTLE.source}|ServiceUnavailable|ModelNotReady|ModelTimeout`, 'i');
const AUTH = /ExpiredToken|UnrecognizedClient|InvalidSignature|AccessDenied|InvalidClientTokenId|security token|credentials? (?:are|is) (?:invalid|expired)|Could not load credentials/i;

const sha12 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const clip = (text, n = 300) => String(text).trim().replace(/\s+/g, ' ').slice(-n);

// One model, one agent. The built-in agents are switched off so the judge agent is the only one that can run.
function configJson(m, { region, profile }) {
  const agent = { mode: 'primary', description: 'bare evaluator', prompt: JUDGE_SYSTEM_PROMPT, tools: { '*': false }, permission: { '*': 'deny' } };
  if (m.temperature !== null) agent.temperature = m.temperature;
  return {
    $schema: 'https://opencode.ai/config.json', share: 'disabled', snapshot: false, autoupdate: false, enabled_providers: [oc.PROVIDER],
    provider: { [oc.PROVIDER]: { options: { region, profile }, models: { [m.bedrockId]: { name: m.bedrockId, limit: m.limit, temperature: m.temperature !== null } } } },
    agent: { ...Object.fromEntries(oc.BUILTIN_AGENTS.map((n) => [n, { disable: true }])), [m.agent]: agent },
  };
}

// Reads the session row(s) of the call's own database. One query: the rollup needs nothing else, and each `opencode db` start costs about a second.
function readSessions(bin, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, ['db', SQL.sessions, '--format', 'json'], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
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

function makeOpencodeCaller({
  bin, credsFile, awsProfile = 'bench', region = 'us-east-1', timeoutMs, version = null, sha256 = null, scratchRoot = os.tmpdir(), rawDir = null,
  maxAttempts = 6, backoffMs = 2000, maxBackoffMs = 60000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const { secrets } = readProfile(credsFile, awsProfile);
  const opencodeVersion = version ?? sandbox.versionOf(bin);
  const scrub = (text) => secrets.filter((s) => s && s.length >= 4).reduce((t, s) => t.split(s).join('<redacted>'), String(text)).replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '<redacted>');

  function keepRaw(model, prompt, outPath, errPath) {
    if (!rawDir) return;
    try {
      fs.mkdirSync(rawDir, { recursive: true });
      const stem = path.join(rawDir, `${model.replace(/[^\w.-]/g, '_')}-${sha12(`${model}\n${prompt}`)}-${Date.now()}`);
      fs.writeFileSync(`${stem}.jsonl`, scrub(fs.readFileSync(outPath, 'utf8')));
      if (fs.statSync(errPath).size) fs.writeFileSync(`${stem}.stderr.txt`, scrub(fs.readFileSync(errPath, 'utf8')));
    } catch { /* auditing must not fail the judge call */ }
  }

  // One try, in its own scratch HOME. Returns {text, ...usage} or {error, throttled?}.
  async function attempt(m, model, prompt) {
    const root = fs.mkdtempSync(path.join(scratchRoot, 'jdg-oc-'));
    procs.trackScratch(root);
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'cwd');
    const tmpdir = path.join(root, 'tmp');
    for (const d of [path.join(home, '.config', 'opencode'), cwd, tmpdir]) fs.mkdirSync(d, { recursive: true });
    const promptPath = path.join(root, 'prompt.txt');
    const outPath = path.join(root, 'stdout.jsonl');
    const errPath = path.join(root, 'stderr.txt');
    try {
      fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), `${JSON.stringify(configJson(m, { region, profile: awsProfile }), null, 2)}\n`);
      installCredentials({ credsFile, profile: awsProfile, home, region });
      fs.writeFileSync(promptPath, prompt);
      const { env } = oc.envSetup({ arm: { vanilla: true }, config: {}, ctx: { awsProfile }, home, tmpdir });
      env.AWS_REGION = region;
      env.AWS_DEFAULT_REGION = region;
      const args = ['run', '--dir', cwd, '--agent', m.agent, '-m', `${oc.PROVIDER}/${m.bedrockId}`, '--format', 'json', '--title', oc.TITLE];
      const exec = await spawnWithTimeout(bin, args, { cwd, env, timeoutMs, stdoutPath: outPath, stderrPath: errPath, stdinPath: promptPath });
      keepRaw(model, prompt, outPath, errPath);
      const base = { text: '', credits: 0, latencyMs: exec.wallClockMs, bedrockModelId: m.bedrockId };
      if (exec.timedOut) return { ...base, error: `timed out after ${timeoutMs} ms` };
      if (exec.error && exec.exitCode === null) return { ...base, error: `opencode failed: ${scrub(exec.error)}` };
      const a = aggregateEvents(parseStream(fs.readFileSync(outPath, 'utf8')).events);
      const stderr = scrub(fs.readFileSync(errPath, 'utf8'));
      const failure = scrub([...a.errors, stderr].join('\n'));
      if (a.toolCalls) return { ...base, error: `the judge agent used a tool (${Object.keys(a.toolNames).join(', ')}); tools must stay off` };
      if (a.errors.length || exec.exitCode !== 0 || a.runFinishedStatus !== 'success' || !a.finalText) {
        if (AUTH.test(failure)) return { ...base, error: `Bedrock credentials were rejected: ${clip(failure)}` };
        if (THROTTLE.test(failure)) return { ...base, throttled: true, error: clip(failure) };
        if (exec.exitCode === 0 && !a.errors.length && !a.steps && !stderr.trim()) return { ...base, error: 'opencode returned no reply' };
        return { ...base, error: `opencode exit ${exec.exitCode}${clip(failure) ? `: ${clip(failure)}` : ''}` };
      }
      let usage = { tokens: a.steps ? { ...a.tokens } : null, usd: a.steps ? a.costUsd : null, usageSource: a.steps ? 'stream' : null };
      try {
        const rolled = rollUp({ sessions: await readSessions(bin, env), messages: [], tools: [] }, a.sessionId);
        if (rolled) {
          if (rolled.rootModel && rolled.rootModel !== m.bedrockId) return { ...base, error: `opencode served model "${rolled.rootModel}", expected "${m.bedrockId}"` };
          usage = { tokens: rolled.tokens, usd: rolled.costUsd, usageSource: 'db' };
        }
      } catch { /* the stream totals stay */ }
      return { ...base, text: a.finalText, ...usage };
    } finally {
      removeCredentials(home);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      procs.untrackScratch(root);
    }
  }

  const caller = async ({ model, prompt }) => {
    let m;
    try { m = opencodeModel(model); } catch (e) { return { text: '', credits: 0, latencyMs: 0, error: e.message }; }
    let retries = 0;
    let throttled = 0;
    let latencyMs = 0;
    let last = null;
    for (let i = 0; i < maxAttempts; i++) {
      last = await attempt(m, model, prompt);
      latencyMs += last.latencyMs ?? 0;
      if (!last.throttled) break;
      throttled++;
      if (i === maxAttempts - 1) break;
      retries++;
      await sleep(Math.min(maxBackoffMs, backoffMs * 2 ** i));
    }
    const { throttled: wasThrottled, ...result } = last;
    if (wasThrottled) result.error = `throttled by Bedrock after ${maxAttempts} attempts: ${result.error}`;
    return { ...result, latencyMs, retries, throttled };
  };

  caller.info = {
    backend: 'opencode', opencodeVersion, binarySha256: sha256, region, awsProfile, systemPrompt: JUDGE_SYSTEM_PROMPT, systemPromptSha256: systemPromptSha256(),
    models: (judges) => Object.fromEntries(judges.map((j) => {
      const m = opencodeModel(j);
      return [j, { bedrockModelId: m.bedrockId, agent: m.agent, temperature: m.temperature, temperatureApplied: m.temperature !== null }];
    })),
  };
  caller.cacheSalt = cacheSaltOf;
  return caller;
}

module.exports = { makeOpencodeCaller, configJson, cacheSaltOf };
