// SPDX-License-Identifier: Apache-2.0
'use strict';

// --introspect end to end on the Claude Code harness, with the fake claude: off, a run is what it was; on, the agent's
// OTLP export reaches the run's loopback sink and the run gets <run>/introspect with probe.json and timeline.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { HARNESSES } = require('../lib/harness/index.js');
const cc = HARNESSES['claude-code'];
const { TELEMETRY_NAME } = require('../lib/introspect/index.js');

const FX = path.join(__dirname, 'fixtures', 'claude-code');
const MODEL = 'us.anthropic.claude-sonnet-5-5';
const CANON = 'claude-sonnet-5-5';
const ARM = { id: 'cc-vanilla', label: 'cc-vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'claude-code', agent: null, vanilla: true };
const CREDS = { AWS_ACCESS_KEY_ID: 'AK' + 'IATESTTESTTEST1234', AWS_SECRET_ACCESS_KEY: 'fakeSecretValueNotReal0123456789abcdefgh', AWS_SESSION_TOKEN: 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==' };
const SAVE = [...Object.keys(CREDS), 'AWS_PROFILE', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'CLAUDE_CODE_ENABLE_TELEMETRY'];

async function withEnv(vars, fn) {
  const saved = Object.fromEntries(SAVE.map((k) => [k, process.env[k]]));
  for (const k of SAVE) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const k of SAVE) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

const OTLP_LOGS = { resourceLogs: [{ scopeLogs: [{ logRecords: [
  { timeUnixNano: '1800000000000000000', attributes: [{ key: 'event.name', value: { stringValue: 'api_request' } }, { key: 'duration_ms', value: { intValue: '1200' } }, { key: 'input_tokens', value: { intValue: '7' } }, { key: 'output_tokens', value: { intValue: '9' } }] },
] }] }] };

function setup(introspectOn) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const tmpBase = path.join(root, 'faketmp');
  fs.mkdirSync(tmpBase);
  const otlpFile = path.join(root, 'otlp-logs.json');
  write(otlpFile, JSON.stringify(OTLP_LOGS));
  const bin = makeFakeClaude(path.join(root, 'tools'), { dir: probe, streamFile: path.join(FX, 'vanilla-success.stream.jsonl'), tmpBases: [tmpBase], otlpLogsFile: otlpFile });
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, canonicalModel: CANON, effort: 'default' }, scratchDir, claude: cc.resolveClaude({ binOverride: bin }), claudeTmpBases: [tmpBase], envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '9.9.9', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' }, runBudgetUsd: 0.75,
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    ...(introspectOn ? { introspect: true, introspectDeps: { flushGraceMs: 50 } } : {}),
  };
  return { root, ctx, task: loadTasks(bench).get('t1'), probe, outDir: path.join(root, 'out', 't1') };
}

const started = (s) => JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8'));
const run = (s) => withEnv({ ...CREDS, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:20774', CLAUDE_CODE_ENABLE_TELEMETRY: '1' }, () => executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 }));

test('without --introspect the agent gets no telemetry variable and the run has no introspect output', async () => {
  const s = setup(false);
  try {
    const result = await run(s);
    assert.equal(result.status, 'success');
    const st = started(s);
    assert.deepEqual(st.envKeys.filter((k) => TELEMETRY_NAME.test(k)), []);
    const expected = cc.envSetup({ arm: ARM, ctx: s.ctx, home: st.home, tmpdir: path.join(path.dirname(st.home), 'tmp'), baseEnv: process.env }).keys;
    // PWD and SHLVL come from the fake's shell stub, not from the harness.
    const own = (keys) => keys.filter((k) => !Object.keys(CREDS).includes(k) && !['PWD', 'SHLVL', '_'].includes(k)).sort();
    assert.deepEqual(own(st.envKeys), own(expected));
    assert.equal(fs.existsSync(path.join(s.outDir, 'introspect')), false);
    assert.equal(result.flags.includes('introspect'), false);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('with --introspect the OTLP export lands in the run sink, not the parent shell endpoint, and the report is written', async () => {
  const s = setup(true);
  try {
    const result = await run(s);
    assert.equal(result.status, 'success');
    assert.ok(result.flags.includes('introspect'));
    const st = started(s);
    assert.match(st.env.OTEL_EXPORTER_OTLP_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.notEqual(st.env.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:20774');
    const dir = path.join(s.outDir, 'introspect');
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    const probe = JSON.parse(fs.readFileSync(path.join(dir, 'probe.json'), 'utf8'));
    assert.equal(probe.sink.received.bySignal.logs, 1);
    for (const k of ['CLAUDE_CODE_ENABLE_TELEMETRY', 'OTEL_EXPORTER_OTLP_ENDPOINT']) assert.ok(probe.parentTelemetryNames.includes(k), k);
    const md = fs.readFileSync(path.join(dir, 'timeline.md'), 'utf8');
    assert.match(md, /^# Introspection: cc-vanilla \/ t1 \/ rep 1/);
    assert.match(md, /\| 1 \| .* \| 1200 ms \| n\/a \| 7 \| 9 \|/);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
