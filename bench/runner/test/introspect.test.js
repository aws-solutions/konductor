// SPDX-License-Identifier: Apache-2.0
'use strict';

// --introspect: the loopback OTLP sink, the environment guard, the collector watch, the probe lifecycle and the
// per-run report. Everything runs offline; the sink binds 127.0.0.1 only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { tmp, write } = require('./helpers.js');
const { startSink } = require('../lib/introspect/otlp-sink.js');
const { parseSs, belongsToRun, startWatch } = require('../lib/introspect/collector-watch.js');
const introspect = require('../lib/introspect/index.js');
const report = require('../lib/introspect/report.js');
const { claudeCode: cc, kiro } = require('../lib/harness/index.js');

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(body);
  });
}

const attrs = (o) => Object.entries(o).map(([key, v]) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) } }));
const logRecord = (name, a, ts) => ({ timeUnixNano: String(BigInt(ts) * 1000000n), body: { stringValue: `claude_code.${name}` }, attributes: attrs({ 'event.name': name, 'event.timestamp': new Date(ts).toISOString(), ...a }) });
const logsBody = (records) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: records }] }] });

const REQUEST_BODY = {
  model: 'claude-sonnet-5-5',
  system: [{ type: 'text', text: 'x-header' }, { type: 'text', text: '# Agent\n\nYou are the agent.\n\n## Rules\n\nBe brief.\n' }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nAttribution note\n</system-reminder>\n' }, { type: 'text', text: 'Explain the file.' }] },
    { role: 'system', content: '# Environment\nwork dir\nThe following skills are available for use with the Skill tool:\n\n- alpha: does a\n- beta: does b\n\nContents of /w/CLAUDE.md (project instructions):\nhi\n' },
  ],
  tools: [{ name: 'Read', description: 'read' }, { name: 'Skill', description: 'Invoke a skill.' }],
};

function claudeOtlpLines(t0 = 1_800_000_000_000) {
  const records = [
    logRecord('hook_execution_complete', { hook_event: 'SessionStart', hook_name: 'SessionStart:startup', total_duration_ms: 12, additional_context_chars: 40 }, t0),
    logRecord('user_prompt', { prompt_length: 17 }, t0 + 10),
    logRecord('api_request_body', { body: JSON.stringify(REQUEST_BODY), body_length: 500 }, t0 + 20),
    logRecord('api_request', { model: 'claude-sonnet-5-5', duration_ms: 1000, ttft_ms: 400, input_tokens: 3, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 900, cost_usd: 0.01, query_source: 'sdk' }, t0 + 1020),
    logRecord('tool_result', { tool_name: 'Skill', success: 'true', duration_ms: 5, tool_input: '{"skill":"alpha"}' }, t0 + 1030),
    logRecord('api_request', { model: 'claude-sonnet-5-5', duration_ms: 2000, ttft_ms: 300, input_tokens: 2, output_tokens: 70, cache_read_tokens: 900, cache_creation_tokens: 100, cost_usd: 0.005, query_source: 'sdk' }, t0 + 3100),
  ];
  return [
    JSON.stringify({ receivedAt: new Date(t0).toISOString(), signal: 'logs', path: '/v1/logs', body: logsBody(records) }),
    JSON.stringify({ receivedAt: new Date(t0).toISOString(), signal: 'metrics', path: '/v1/metrics', body: { resourceMetrics: [] } }),
  ].join('\n') + '\n';
}

const CC_STREAM = [
  { type: 'system', subtype: 'init', model: 'us.anthropic.claude-sonnet-5-5', slash_commands: ['alpha', 'beta'] },
  { type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', hook_name: 'SessionStart:startup', exit_code: 0, outcome: 'success', output: 'Orchestration: auto' },
  { type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 'tu1', name: 'Skill', input: { skill: 'alpha' } }], usage: { input_tokens: 3, output_tokens: 50 } }, parent_tool_use_id: null },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Launching skill: alpha' }] }, parent_tool_use_id: null },
  { type: 'assistant', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/x/skills/alpha/references/more.md' } }] }, parent_tool_use_id: null },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'more' }] }, parent_tool_use_id: null },
  { type: 'result', subtype: 'success', result: 'Done.', total_cost_usd: 0.015, duration_ms: 3100, num_turns: 2 },
].map((e) => JSON.stringify(e)).join('\n') + '\n';

function claudeRunDir(root) {
  const run = path.join(root, 'run');
  write(path.join(run, 'result.json'), JSON.stringify({ armId: 'cc-main', taskId: 't1', replicate: 1, harness: 'claude-code', model: 'us.anthropic.claude-sonnet-5-5', status: 'success', checks: [{ passed: true }, { passed: false }], flags: ['introspect'], finalText: 'Done.', costUsd: 0.015, wallClockMs: 4000 }));
  write(path.join(run, 'stream.jsonl'), CC_STREAM);
  write(path.join(run, 'introspect', 'otlp.jsonl'), claudeOtlpLines());
  write(path.join(run, 'introspect', 'probe.json'), JSON.stringify({ harness: 'claude-code', sink: { url: 'http://127.0.0.1:1', received: { requests: 2, bytes: 10, bySignal: { logs: 1, metrics: 1, traces: 0, other: 0 } } }, collectorWatch: { available: true, ports: [20774], samples: 5, runConnections: [], clean: true } }));
  return run;
}

test('the sink binds loopback, keeps JSON and gzip bodies, refuses non-POST and counts by signal', async () => {
  const root = tmp();
  try {
    const file = path.join(root, 'otlp.jsonl');
    const sink = await startSink({ file });
    assert.match(sink.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await post(`${sink.url}/v1/logs`, JSON.stringify({ resourceLogs: [] }), { 'content-type': 'application/json' }), 200);
    assert.equal(await post(`${sink.url}/v1/traces`, zlib.gzipSync(JSON.stringify({ resourceSpans: [] })), { 'content-type': 'application/json', 'content-encoding': 'gzip' }), 200);
    assert.equal(await post(`${sink.url}/v1/metrics`, Buffer.from([1, 2, 3]), { 'content-type': 'application/x-protobuf' }), 200);
    const got = await new Promise((resolve) => http.get(`${sink.url}/v1/logs`, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }));
    assert.equal(got, 405);
    const counts = await sink.stop();
    assert.deepEqual(counts.bySignal, { logs: 1, metrics: 1, traces: 1, other: 0 });
    assert.equal(counts.rejected, 1);
    assert.equal(counts.protobuf, 1);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines[1].body, { resourceSpans: [] });
    assert.match(lines[2].note, /non-JSON body/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the probe environment sends every OTLP signal to the sink and nothing else', () => {
  const env = introspect.claudeEnv('http://127.0.0.1:4242');
  for (const [k, v] of Object.entries(env)) if (/ENDPOINT$/.test(k)) assert.ok(v.startsWith('http://127.0.0.1:4242'), k);
  assert.equal(env.OTEL_LOG_RAW_API_BODIES, '1');
  assert.equal(env.OTEL_EXPORTER_OTLP_PROTOCOL, 'http/json');
  const merged = introspect.mergeEnv({ PATH: '/bin', DISABLE_TELEMETRY: '1' }, env, { sinkUrl: 'http://127.0.0.1:4242' });
  assert.equal(merged.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://127.0.0.1:4242');
});

test('mergeEnv refuses a telemetry variable the probe did not set and an endpoint that is not the sink', () => {
  const env = introspect.claudeEnv('http://127.0.0.1:4242');
  assert.throws(() => introspect.mergeEnv({ OTEL_RESOURCE_ATTRIBUTES: 'a=b' }, env, { sinkUrl: 'http://127.0.0.1:4242' }), /did not set: OTEL_RESOURCE_ATTRIBUTES/);
  assert.throws(() => introspect.mergeEnv({}, { ...env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:20774' }, { sinkUrl: 'http://127.0.0.1:4242' }), /does not point at the run's loopback sink/);
  assert.throws(() => introspect.mergeEnv({}, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' }, { sinkUrl: null }), /loopback sink/);
});

test('the harness environments carry no telemetry endpoint of the parent shell', () => {
  const base = { PATH: '/bin', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:20774', CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', AWS_ACCESS_KEY_ID: 'AKIAFAKE', AWS_SECRET_ACCESS_KEY: 'x' };
  const ccEnv = cc.envSetup({ arm: { vanilla: false }, ctx: {}, home: '/h', tmpdir: '/t', baseEnv: base }).env;
  assert.deepEqual(Object.keys(ccEnv).filter((k) => introspect.TELEMETRY_NAME.test(k)), []);
  const saved = { ...process.env };
  try {
    Object.assign(process.env, base);
    const kEnv = kiro.env({ arm: { vanilla: false }, config: { agentEngine: 'v3' }, ctx: { envKeep: [] }, home: '/h', tmpdir: '/t' });
    assert.deepEqual(Object.keys(kEnv).filter((k) => introspect.TELEMETRY_NAME.test(k)), []);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the kiro probe switches on the request and configuration dumps under the run root', () => {
  const env = introspect.kiroEnv('/r/introspect');
  assert.deepEqual(env, {
    KIRO_DUMP_REQUESTS: '1', KIRO_DUMP_REQUESTS_DIR: '/r/introspect/requests', KIRO_DUMP_CONFIGURATION: '1',
    KIRO_DUMP_CONFIGURATION_DIR: '/r/introspect/configuration', KIRO_TIMELINE: '1', KIRO_LOG_LEVEL: 'debug',
  });
  assert.equal(introspect.mergeEnv({ HOME: '/h' }, env).KIRO_DUMP_REQUESTS, '1');
});

test('parseSs reads peers and owning processes; belongsToRun matches the run HOME or cwd', () => {
  const rows = parseSs('ESTAB 0 0 127.0.0.1:5001 127.0.0.1:20774 users:(("claude",pid=11,fd=3))\nESTAB 0 0 [::1]:5 [::1]:4318 users:(("x",pid=12,fd=1),("y",pid=13,fd=2))\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].peerPort, 20774);
  assert.deepEqual(rows[1].pids.map((p) => p.pid), [12, 13]);
  const environOf = (pid) => (pid === 11 ? ['HOME=/r/home'] : ['HOME=/other']);
  const cwdOf = (pid) => (pid === 13 ? '/r/work' : '/');
  assert.equal(belongsToRun(11, { home: '/r/home', runRoot: '/r', environOf, cwdOf }), true);
  assert.equal(belongsToRun(12, { home: '/r/home', runRoot: '/r', environOf, cwdOf }), false);
  assert.equal(belongsToRun(13, { home: '/r/home', runRoot: '/r', environOf, cwdOf }), true);
});

test('the collector watch reports a run connection, counts others, and says when it cannot run', () => {
  const ss = () => ({ status: 0, stdout: 'ESTAB 0 0 127.0.0.1:5001 127.0.0.1:20774 users:(("claude",pid=11,fd=3))\nESTAB 0 0 127.0.0.1:5002 127.0.0.1:20774 users:(("host",pid=99,fd=3))\nESTAB 0 0 127.0.0.1:5003 127.0.0.1:443 users:(("claude",pid=11,fd=4))\n' });
  const deps = { environOf: (pid) => (pid === 11 ? ['HOME=/r/home'] : []), cwdOf: () => null };
  const w = startWatch({ home: '/r/home', runRoot: '/r', platform: 'linux', ss, deps, intervalMs: 10000 });
  const rec = w.stop();
  assert.equal(rec.clean, false);
  assert.equal(rec.runConnections.length, 1);
  assert.equal(rec.runConnections[0].peer, '127.0.0.1:20774');
  assert.ok(rec.otherConnections >= 1);
  const off = startWatch({ home: '/h', runRoot: '/r', platform: 'darwin' }).stop();
  assert.equal(off.available, false);
  assert.match(off.note, /darwin/);
});

test('startProbe and afterExit for Claude Code: private dirs, transcripts copied, links skipped, probe.json written', async () => {
  const root = tmp();
  try {
    const outDir = path.join(root, 'out');
    const runRoot = path.join(root, 'r');
    const home = path.join(runRoot, 'home');
    write(path.join(home, '.claude', 'projects', 'slug', 's1.jsonl'), '{"type":"user","message":{"content":"hi"}}\n');
    write(path.join(home, '.claude', 'projects', 'slug', 's1', 'subagents', 'agent-a.jsonl'), '{"type":"user","message":{"content":"brief"}}\n');
    write(path.join(root, 'secret.txt'), 'outside');
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(home, '.claude', 'projects', 'slug', 'link.jsonl'));
    write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x' } }));
    fs.mkdirSync(outDir, { recursive: true });
    const probe = await introspect.startProbe({ harnessId: 'claude-code', outDir, runRoot, home, baseEnv: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:20774', PATH: '/bin' }, deps: { flushGraceMs: 0, startWatch: () => ({ stop: () => ({ available: true, samples: 1, runConnections: [], clean: true }) }) } });
    const env = probe.apply({ PATH: '/bin', HOME: home });
    assert.ok(env.OTEL_EXPORTER_OTLP_ENDPOINT.startsWith('http://127.0.0.1:'));
    await post(env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, JSON.stringify(logsBody([])), { 'content-type': 'application/json' });
    const rec = await probe.afterExit();
    assert.equal(fs.statSync(path.join(outDir, 'introspect')).mode & 0o777, 0o700);
    assert.equal(rec.sink.received.bySignal.logs, 1);
    assert.deepEqual(rec.parentTelemetryNames, ['OTEL_EXPORTER_OTLP_ENDPOINT']);
    assert.deepEqual(rec.settingsTelemetryNames, ['OTEL_EXPORTER_OTLP_ENDPOINT']);
    assert.deepEqual(rec.copied.claudeProjects.copied.sort(), [path.join('.claude/projects/slug/s1.jsonl'), path.join('.claude/projects/slug/s1/subagents/agent-a.jsonl')].sort());
    assert.deepEqual(rec.copied.claudeProjects.skipped.map((s) => s.reason), ['symlink']);
    assert.ok(fs.existsSync(path.join(outDir, 'introspect', 'claude-projects', 'slug', 's1', 'subagents', 'agent-a.jsonl')));
    assert.equal(fs.statSync(path.join(outDir, 'introspect', 'probe.json')).mode & 0o777, 0o600);
    assert.equal(await probe.afterExit(), rec);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('afterExit for kiro-cli copies the dumps and log files and leaves other files behind', async () => {
  const root = tmp();
  try {
    const outDir = path.join(root, 'out');
    const runRoot = path.join(root, 'r');
    const home = path.join(runRoot, 'home');
    fs.mkdirSync(outDir, { recursive: true });
    const probe = await introspect.startProbe({ harnessId: 'kiro-cli', outDir, runRoot, home, baseEnv: {}, deps: { startWatch: () => ({ stop: () => ({ available: true, samples: 1, runConnections: [], clean: true }) }) } });
    const env = probe.apply({ HOME: home });
    write(path.join(env.KIRO_DUMP_REQUESTS_DIR, 'sess_1', '0000-1000.json'), '{}');
    write(path.join(runRoot, 'tmp', 'kiro-log', 'kiro-chat.log'), 'line\n');
    write(path.join(home, '.kiro', 'logs', 'x', 'kiro.log'), 'line\n');
    write(path.join(home, '.kiro', 'logs', 'x', 'events.json'), '{}');
    write(path.join(home, '.kiro', 'login.json'), '{"token":"t"}');
    write(path.join(home, '.local', 'share', 'kiro-cli', 'data.sqlite3'), 'db');
    write(path.join(home, '.kiro', 'sessions', 'logs', 'a.json'), '{}');
    assert.equal(env.KIRO_DUMP_REQUESTS_DIR, path.join(`${runRoot}-introspect`, 'requests'), 'the dumps go next to the run root, not inside it');
    assert.equal(fs.statSync(`${runRoot}-introspect`).mode & 0o777, 0o700);
    const rec = await probe.afterExit();
    assert.deepEqual(rec.copied.kiroDumps.copied, [path.join('requests/sess_1/0000-1000.json')]);
    assert.ok(fs.existsSync(path.join(outDir, 'introspect', 'kiro', 'requests', 'sess_1', '0000-1000.json')));
    assert.equal(rec.kiroDumpRoot.outsideRunRoot, true);
    assert.deepEqual(rec.copied.tmpLogs.copied, [path.join('tmp/kiro-log/kiro-chat.log')]);
    assert.deepEqual(rec.copied.homeLogs.copied.sort(), [path.join('.kiro/logs/x/events.json'), path.join('.kiro/logs/x/kiro.log')]);
    assert.equal(fs.existsSync(path.join(outDir, 'introspect', 'home-logs', '.kiro', 'login.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the Claude Code report reads requests, the first request, hooks and skills from the probe files', () => {
  const root = tmp();
  try {
    const run = claudeRunDir(root);
    const r = report.buildReport(run);
    assert.equal(r.requests.length, 2);
    assert.deepEqual(r.requests.map((q) => [q.latencyMs, q.ttftMs, q.input, q.output, q.cacheWrite]), [[1000, 400, 3, 50, 900], [2000, 300, 2, 70, 100]]);
    assert.equal(r.requests[0].offsetMs, 20);
    assert.deepEqual(r.first.skillsListed, ['alpha', 'beta']);
    assert.deepEqual(r.first.contextFiles, [{ path: '/w/CLAUDE.md', kind: 'project instructions' }]);
    assert.equal(r.first.systemReminders.length, 1);
    assert.deepEqual(r.first.blocks.map((b) => b.where), ['system[0]', 'system[1]', 'messages[0]', 'messages[1]']);
    assert.deepEqual(r.first.tools.map((t) => t.name), ['Read', 'Skill']);
    assert.deepEqual(r.skills.loaded, ['alpha']);
    assert.deepEqual(r.skills.listedNotLoaded, ['beta']);
    assert.deepEqual(r.skills.referenceReads.map((x) => x.path), ['/x/skills/alpha/references/more.md']);
    assert.ok(r.hooks.some((h) => h.source === 'stream' && h.output === 'Orchestration: auto'));
    assert.ok(r.hooks.some((h) => h.source === 'otel' && /additional_context_chars=40/.test(h.output)));
    assert.deepEqual(report.probeMatrix(r).map((row) => row[1]), ['yes', 'yes', 'yes', 'yes', 'yes']);
    const md = report.renderReport(r);
    assert.match(md, /\| P1 exact model input \| yes \|/);
    assert.match(md, /model request done 1000 ms \(ttft 400 ms\)/);
    assert.match(md, /- skills listed: 2: alpha, beta/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a Claude Code report with no OTEL data falls back to stream usage and says what is missing', () => {
  const root = tmp();
  try {
    const run = claudeRunDir(root);
    fs.writeFileSync(path.join(run, 'introspect', 'otlp.jsonl'), '');
    const r = report.buildReport(run);
    assert.equal(r.first, null);
    assert.deepEqual(r.requests.map((q) => [q.source, q.input, q.output, q.latencyMs]), [['stream', 3, 50, null], ['stream', 0, 0, null]]);
    const rows = report.probeMatrix(r);
    assert.equal(rows[0][1], 'no');
    assert.equal(rows[4][2], 'needs P1');
    assert.match(report.renderReport(r), /No request body was captured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the kiro-cli report pairs timeline markers with request dumps and reads hooks from the engine log', () => {
  const root = tmp();
  try {
    const run = path.join(root, 'run');
    const state = (history, content) => ({ invocation: { agentName: null, executionId: 'e1' }, request: { conversationState: { history, currentMessage: { userInputMessage: { content, modelId: 'claude-sonnet-5.5', userInputMessageContext: { tools: [{ toolSpecification: { name: 'read_file', description: 'r' } }] } } } } }, response: {} });
    const sys = [{ userInputMessage: { content: '# Konductor\n\n## Your skills\n\n- alpha: a\n- beta: b\n\n## Other\n' } }, { assistantResponseMessage: { content: 'ok' } }];
    write(path.join(run, 'introspect', 'kiro', 'requests', 'sess_1', '0000-1010.json'), JSON.stringify(state(sys, 'do it')));
    write(path.join(run, 'introspect', 'kiro', 'requests', 'sess_1', '0001-3010.json'), JSON.stringify(state([...sys, {}, {}], '<HOOK_INSTRUCTION>remember x</HOOK_INSTRUCTION>')));
    write(path.join(run, 'introspect', 'kiro', 'requests', 'conv-title', '0000-900.json'), JSON.stringify({ invocation: {}, request: { conversationState: { history: [], currentMessage: { userInputMessage: { content: 'title please', modelId: 'simple-task' } } } } }));
    const marker = (o) => JSON.stringify({ timestamp: new Date(o.ts).toISOString(), level: 'info', message: `KIRO_TIMELINE ${JSON.stringify(o)}` });
    write(path.join(run, 'introspect', 'home-logs', '.kiro', 'logs', 'x', 'kiro.log'), [
      JSON.stringify({ timestamp: new Date(950).toISOString(), level: 'info', message: 'hooks.reload.loaded {"read":1}' }),
      marker({ ts: 1000, kind: 'model_start', executionId: 'e1', actionId: 'a1' }),
      marker({ ts: 2500, kind: 'model_end', executionId: 'e1', actionId: 'a1', status: 'Success', durationMs: 1500 }),
      marker({ ts: 3000, kind: 'model_start', executionId: 'e1', actionId: 'a2' }),
      marker({ ts: 4000, kind: 'model_end', executionId: 'e1', actionId: 'a2', status: 'Success', durationMs: 1000 }),
      JSON.stringify({ timestamp: new Date(2600).toISOString(), level: 'debug', message: 'hooks.preToolUse.invoke {"toolId":"read_file"}' }),
    ].join('\n') + '\n');
    write(path.join(run, 'result.json'), JSON.stringify({ armId: 'kmain', taskId: 't1', replicate: 1, harness: 'kiro-cli', model: 'claude-sonnet-5.5', status: 'success', checks: [], flags: [], credits: 0.5 }));
    write(path.join(run, 'stream.jsonl'), `${JSON.stringify({ type: 'runFinished', data: { status: 'success', finalText: 'done' } })}\n`);
    const r = report.buildReport(run);
    assert.deepEqual(r.requests.map((q) => [q.latencyMs, q.source, q.history]), [[1500, 'timeline+dump', 2], [1000, 'timeline+dump', 4]]);
    assert.deepEqual(r.first.skillsListed, ['alpha', 'beta']);
    assert.deepEqual(r.first.tools.map((t) => t.name), ['read_file']);
    assert.equal(r.sideRequests.length, 1);
    assert.equal(r.sideRequests[0].model, 'simple-task');
    assert.ok(r.hooks.some((h) => h.phase === 'hooks.preToolUse.invoke'));
    assert.ok(r.hooks.some((h) => /HOOK_INSTRUCTION/.test(h.phase) && h.output === 'remember x'));
    const rows = report.probeMatrix(r);
    assert.equal(rows[1][1], 'timing only');
    assert.match(report.renderReport(r), /kiro-cli reports no tokens per request/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sectionsOf splits on headings, column-0 tags and the Claude Code listing headers', () => {
  const text = '# Environment\nabc\nThe following skills are available for use with the Skill tool:\n\n- a: b\n<steering-files>\nx\n';
  assert.deepEqual(report.sectionsOf(text).map((s) => s.title), ['# Environment', 'The following skills are available for use with the Skill tool:', '<steering-files>']);
  assert.equal(report.sectionsOf(text).reduce((n, s) => n + s.chars, 0), text.length);
});

test('writeReport writes a private timeline.md and timeline.json', () => {
  const root = tmp();
  try {
    const run = claudeRunDir(root);
    report.writeReport(run);
    for (const f of ['timeline.md', 'timeline.json']) assert.equal(fs.statSync(path.join(run, 'introspect', f)).mode & 0o777, 0o600);
    const j = JSON.parse(fs.readFileSync(path.join(run, 'introspect', 'timeline.json'), 'utf8'));
    assert.equal(j.requests.length, 2);
    assert.equal(j.trace, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runConfigRecord names the probe variables and marks the runs not comparable', () => {
  const cc1 = introspect.runConfigRecord('claude-code');
  assert.equal(cc1.comparable, false);
  assert.ok(cc1.claudeCode.variables.includes('OTEL_LOG_RAW_API_BODIES'));
  assert.equal(cc1.kiroCli, undefined);
  assert.ok(introspect.runConfigRecord('kiro-cli').kiroCli.variables.includes('KIRO_DUMP_REQUESTS'));
});

test('introspect-summary finds the runs of an out dir and writes one row each, with the mean per arm', () => {
  const root = tmp();
  try {
    const run = claudeRunDir(root);
    const { findRuns, rowOf, render } = require('../../scripts/introspect-summary.js');
    assert.deepEqual(findRuns(root), [run]);
    const row = rowOf(run, root, true);
    assert.equal(row.requests, 2);
    assert.equal(row.input, 5);
    assert.equal(row.skillsListed, 2);
    assert.equal(row.collectorClean, true);
    assert.equal(row.timeline, path.join('run', 'introspect', 'timeline.md'));
    const md = render([row]);
    assert.match(md, /1 run\(s\)\. Collector watch: 1 clean/);
    assert.match(md, /\| cc-main \| t1 \| 1 \|/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the report lists the tool names the prompt mentions and whether each is in the tool list', () => {
  const tools = [{ name: 'read_file' }, { name: 'load_resource' }, { name: '@konductor-skills/find_skills' }];
  const text = 'Load a skill with the `get_skill` tool; if it is deferred, load it with `tool_load` first. Use `read_file`, `get_skill`. '
    + 'tool::konductor-skills::find_skills and tool::konductor-skills::get_skill';
  assert.deepEqual(report.toolNamesInPrompt(text, tools), [
    { name: 'get_skill', mentions: 3, inToolList: false },
    { name: 'tool_load', mentions: 1, inToolList: false },
    { name: 'find_skills', mentions: 1, inToolList: true },
    { name: 'read_file', mentions: 1, inToolList: true },
  ]);
});

test('the probe kind comes from the harness descriptor: OTLP for Claude Code, the request dump for kiro-cli, none otherwise', () => {
  assert.equal(introspect.probeOf('claude-code'), introspect.OTLP);
  assert.equal(introspect.probeOf('kiro-cli'), introspect.DUMP);
  for (const id of ['opencode', 'strands', null, 'no-such-harness']) assert.equal(introspect.probeOf(id), null);
  assert.deepEqual(introspect.probeWritableDirs({ harnessId: 'opencode', runRoot: '/x' }), []);
  const rc = introspect.runConfigRecord('opencode');
  assert.equal(rc.claudeCode, undefined);
  assert.equal(rc.kiroCli, undefined);
});
