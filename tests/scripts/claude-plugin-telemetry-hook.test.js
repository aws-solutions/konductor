// SPDX-License-Identifier: Apache-2.0
//
// Tests for scripts/claude-plugin-telemetry-hook.js, the Claude Code plugin's
// telemetry hook. Each end-to-end case runs the hook from a scratch plugin
// tree with a scratch HOME, and preloads claude-plugin-telemetry-https-stub.js
// so nothing reaches the real endpoint.
//
// Run: node --test tests/scripts/claude-plugin-telemetry-hook.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_SOURCE = path.join(REPO_ROOT, 'scripts', 'claude-plugin-telemetry-hook.js');
const HOOKS_RENDERER = path.join(REPO_ROOT, 'scripts', 'render-claude-plugin-hooks-json.py');
const SCHEMA_PATH = path.join(REPO_ROOT, 'docs', 'telemetry-schema.json');
const REPORT_RS = path.join(REPO_ROOT, 'cli', 'konductor-rs', 'src', 'cli', 'telemetry', 'report.rs');
const STUB = path.join(__dirname, 'claude-plugin-telemetry-https-stub.js');

const hook = require(HOOK_SOURCE);

const PLUGIN_VERSION = '9.8.7';
const AGENTS = ['konductor', 'k-architect', 'k-developer'];
const RAW_SESSION_ID = 'bd3b7f9b-1111-2222-3333-444455556666';
const HEX64 = /^[a-f0-9]{64}$/;

function scratchDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `konductor-plugin-telemetry-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makePluginTree(t) {
  const root = scratchDir(t, 'plugin');
  fs.mkdirSync(path.join(root, '.claude-plugin'));
  fs.mkdirSync(path.join(root, 'agents'));
  fs.mkdirSync(path.join(root, 'hooks'));
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'konductor', version: PLUGIN_VERSION }),
  );
  for (const agent of AGENTS) {
    fs.writeFileSync(path.join(root, 'agents', `${agent}.md`), `---\nname: ${agent}\n---\nbody\n`);
  }
  fs.copyFileSync(HOOK_SOURCE, path.join(root, 'hooks', 'konductor-telemetry.js'));
  return root;
}

// Runs the hook once. `env` is the whole environment apart from PATH, HOME
// and the stub's output file, so the developer's own settings never leak in.
function runHook(t, { eventType, payload, env = {}, home, stdin }) {
  const plugin = makePluginTree(t);
  const homeDir = home || scratchDir(t, 'home');
  const project = scratchDir(t, 'project');
  const stubOut = path.join(scratchDir(t, 'stub'), 'requests.jsonl');
  const input =
    stdin !== undefined ? stdin : JSON.stringify({ cwd: project, session_id: RAW_SESSION_ID, ...payload });
  const result = spawnSync(
    process.execPath,
    ['--require', STUB, path.join(plugin, 'hooks', 'konductor-telemetry.js'), ...(eventType ? [eventType] : [])],
    {
      input,
      cwd: project,
      env: { PATH: process.env.PATH, HOME: homeDir, TELEMETRY_STUB_OUT: stubOut, ...env },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  const requests = fs.existsSync(stubOut)
    ? fs
        .readFileSync(stubOut, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { result, requests, home: homeDir, project };
}

function recordPath(home) {
  return path.join(home, '.konductor', 'telemetry.json');
}

function writeRecord(home, record) {
  fs.mkdirSync(path.join(home, '.konductor'), { recursive: true });
  const text = typeof record === 'string' ? record : `${JSON.stringify(record, null, 2)}\n`;
  fs.writeFileSync(recordPath(home), text);
  return text;
}

const VALID_UUID = 'ab'.repeat(32);

function assertSilent(result) {
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

// ── Contract with the schema and the CLI ─────────────────────────────────

test('body from the exported builder has every schema-required field', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const sessionPattern = new RegExp(schema.properties.sessionId.pattern);
  for (const eventType of ['agent_invocation', 'subagent_invocation']) {
    const body = hook.buildEventBody({
      eventType,
      targetName: 'k-architect',
      uuid: VALID_UUID,
      version: PLUGIN_VERSION,
      sessionId: RAW_SESSION_ID,
      parentSessionId: eventType === 'subagent_invocation' ? RAW_SESSION_ID : null,
      parentAgentName: eventType === 'subagent_invocation' ? 'konductor' : null,
    });
    assert.deepEqual(Object.keys(body), ['Solution', 'Version', 'UUID', 'TimeStamp', 'Data']);
    for (const key of schema.required) {
      assert.ok(Object.hasOwn(body.Data, key), `${eventType} is missing ${key}`);
    }
    assert.match(body.Data.sessionId, sessionPattern);
    assert.match(body.Data.eventId, new RegExp(schema.properties.eventId.pattern));
    assert.equal(body.Data.harness, null);
    assert.equal(body.Data.errorCode, null);
    assert.equal(body.Data.agentVersion, null);
    assert.match(body.TimeStamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d$/);
    assert.match(body.Data.TimeStamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
});

test('session ids are hashed as sha256(UUID + raw id), and absent ids stay null', () => {
  const crypto = require('node:crypto');
  const body = hook.buildEventBody({
    eventType: 'agent_invocation',
    targetName: 'konductor',
    uuid: VALID_UUID,
    version: PLUGIN_VERSION,
    sessionId: RAW_SESSION_ID,
  });
  const expected = crypto.createHash('sha256').update(`${VALID_UUID}${RAW_SESSION_ID}`).digest('hex');
  assert.equal(body.Data.sessionId, expected);
  assert.equal(body.Data.parentSessionId, null);
  assert.equal(body.Data.parentAgentName, null);
  const empty = hook.buildEventBody({ eventType: 'agent_invocation', targetName: 'x', uuid: VALID_UUID, version: '1', sessionId: '' });
  assert.equal(empty.Data.sessionId, null);
});

test('endpoint and solution id match the CLI source', () => {
  const source = fs.readFileSync(REPORT_RS, 'utf8');
  const endpoint = /const DEFAULT_TELEMETRY_ENDPOINT: &str = "([^"]+)";/.exec(source);
  const solution = /const SOLUTION_ID: &str = "([^"]+)";/.exec(source);
  assert.ok(endpoint && solution, 'constants not found in report.rs');
  assert.equal(hook.DEFAULT_TELEMETRY_ENDPOINT, endpoint[1]);
  assert.equal(hook.SOLUTION_ID, solution[1]);
});

// ── End to end ───────────────────────────────────────────────────────────

test('SessionStart for a plugin agent posts one agent_invocation', (t) => {
  const { result, requests, home } = runHook(t, {
    eventType: 'agent-invocation',
    payload: { hook_event_name: 'SessionStart', source: 'startup', agent_type: 'konductor:konductor' },
  });
  assertSilent(result);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.url, hook.DEFAULT_TELEMETRY_ENDPOINT);
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['Content-Type'], 'application/json');
  const body = JSON.parse(request.body);
  const record = JSON.parse(fs.readFileSync(recordPath(home), 'utf8'));
  assert.equal(body.Solution, 'SO0370');
  assert.equal(body.Version, PLUGIN_VERSION);
  assert.equal(body.UUID, record.UUID);
  assert.equal(body.Data.eventType, 'agent_invocation');
  assert.equal(body.Data.targetName, 'konductor');
  assert.match(body.Data.sessionId, HEX64);
  assert.equal(body.Data.parentSessionId, null);
});

test('a bare agent name is reported the same way', (t) => {
  const { requests } = runHook(t, { eventType: 'agent-invocation', payload: { agent_type: 'k-architect' } });
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).Data.targetName, 'k-architect');
});

test('SubagentStart reports the target and a Konductor parent from CLAUDE_CODE_AGENT', (t) => {
  const { requests } = runHook(t, {
    eventType: 'subagent-invocation',
    payload: { hook_event_name: 'SubagentStart', agent_id: 'a36b', agent_type: 'konductor:k-developer' },
    env: { CLAUDE_CODE_AGENT: 'konductor:konductor' },
  });
  assert.equal(requests.length, 1);
  const data = JSON.parse(requests[0].body).Data;
  assert.equal(data.eventType, 'subagent_invocation');
  assert.equal(data.targetName, 'k-developer');
  assert.equal(data.parentAgentName, 'konductor');
  assert.equal(data.parentSessionId, data.sessionId);
});

test('a non-Konductor parent agent is never named', (t) => {
  for (const parent of ['my-own-agent', 'other-plugin:konductor', undefined]) {
    const env = parent === undefined ? {} : { CLAUDE_CODE_AGENT: parent };
    const { requests } = runHook(t, {
      eventType: 'subagent-invocation',
      payload: { agent_type: 'konductor:k-architect' },
      env,
    });
    assert.equal(requests.length, 1, String(parent));
    assert.equal(JSON.parse(requests[0].body).Data.parentAgentName, null, String(parent));
  }
});

test('non-Konductor agents send nothing, including other namespaces', (t) => {
  for (const agentType of ['Explore', 'general-purpose', 'other-plugin:k-architect', 'konductor:not-ours', 'konductor:', '']) {
    for (const eventType of ['agent-invocation', 'subagent-invocation']) {
      const { result, requests, home } = runHook(t, { eventType, payload: { agent_type: agentType } });
      assertSilent(result);
      assert.equal(requests.length, 0, `${eventType} ${agentType}`);
      assert.equal(fs.existsSync(recordPath(home)), false, 'no record minted for a dropped event');
    }
  }
});

test('a SessionStart with no agent_type sends nothing', (t) => {
  const { result, requests } = runHook(t, {
    eventType: 'agent-invocation',
    payload: { hook_event_name: 'SessionStart', source: 'startup' },
  });
  assertSilent(result);
  assert.equal(requests.length, 0);
});

// ── Opt-outs ─────────────────────────────────────────────────────────────

const AGENT_EVENT = { eventType: 'agent-invocation', payload: { agent_type: 'konductor:konductor' } };

test('KONDUCTOR_TELEMETRY=off suppresses sending and minting', (t) => {
  const { result, requests, home } = runHook(t, { ...AGENT_EVENT, env: { KONDUCTOR_TELEMETRY: 'off' } });
  assertSilent(result);
  assert.equal(requests.length, 0);
  assert.equal(fs.existsSync(recordPath(home)), false);
});

test('telemetry.enabled: false in the project config suppresses sending', (t) => {
  const project = scratchDir(t, 'config-project');
  fs.mkdirSync(path.join(project, '.konductor'));
  fs.writeFileSync(path.join(project, '.konductor', 'config.yml'), 'telemetry:\n  enabled: false\n');
  const { result, requests } = runHook(t, {
    eventType: 'agent-invocation',
    stdin: JSON.stringify({ cwd: project, session_id: RAW_SESSION_ID, agent_type: 'konductor:konductor' }),
  });
  assertSilent(result);
  assert.equal(requests.length, 0);
});

test('telemetry_consent: false in the machine record suppresses sending', (t) => {
  const home = scratchDir(t, 'declined-home');
  const text = writeRecord(home, {
    schema_version: 1,
    UUID: VALID_UUID,
    created_at: '2026-01-01T00:00:00.000Z',
    telemetry_consent: false,
  });
  const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
  assertSilent(result);
  assert.equal(requests.length, 0);
  assert.equal(fs.readFileSync(recordPath(home), 'utf8'), text);
});

test('the plugin telemetry_enabled option set to false suppresses sending', (t) => {
  const { result, requests } = runHook(t, { ...AGENT_EVENT, env: { CLAUDE_PLUGIN_OPTION_TELEMETRY_ENABLED: 'false' } });
  assertSilent(result);
  assert.equal(requests.length, 0);
  const enabled = runHook(t, { ...AGENT_EVENT, env: { CLAUDE_PLUGIN_OPTION_TELEMETRY_ENABLED: 'true' } });
  assert.equal(enabled.requests.length, 1);
});

test('config parser reads telemetry.enabled the way the CLI does', () => {
  const off = [
    'telemetry:\n  enabled: false\n',
    'telemetry:\n  endpoint: https://x\n  enabled: false # off\n',
    'telemetry: {enabled: false}\n',
    'other: 1\ntelemetry:\n    enabled: False\n',
  ];
  const on = [
    'telemetry:\n  enabled: true\n',
    'telemetry:\n  enabled: "false"\n',
    'enabled: false\n',
    'other:\n  enabled: false\n',
    'telemetry:\n  nested:\n    enabled: false\n',
    '# telemetry:\n#   enabled: false\n',
    '',
  ];
  for (const text of off) {
    assert.equal(hook.configDisablesTelemetry(text), true, JSON.stringify(text));
  }
  for (const text of on) {
    assert.equal(hook.configDisablesTelemetry(text), false, JSON.stringify(text));
  }
});

// ── Identity ─────────────────────────────────────────────────────────────

test('creates the machine record with mode 0600 when missing', (t) => {
  const { requests, home } = runHook(t, AGENT_EVENT);
  const record = JSON.parse(fs.readFileSync(recordPath(home), 'utf8'));
  assert.deepEqual(Object.keys(record), ['schema_version', 'UUID', 'created_at', 'telemetry_consent']);
  assert.equal(record.schema_version, 1);
  assert.match(record.UUID, HEX64);
  assert.equal(record.telemetry_consent, true);
  assert.equal(JSON.parse(requests[0].body).UUID, record.UUID);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(recordPath(home)).mode & 0o777, 0o600);
  }
  const leftovers = fs.readdirSync(path.join(home, '.konductor')).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('never overwrites an existing record and sends its UUID', (t) => {
  const home = scratchDir(t, 'existing-home');
  const text = writeRecord(home, {
    schema_version: 1,
    UUID: VALID_UUID,
    created_at: '2026-01-01T00:00:00.000Z',
    telemetry_consent: true,
  });
  const { requests } = runHook(t, { ...AGENT_EVENT, home });
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).UUID, VALID_UUID);
  assert.equal(fs.readFileSync(recordPath(home), 'utf8'), text);
});

test('an invalid record resolves to the nil sentinel, is left alone, and sends nothing', (t) => {
  const invalid = [
    '{not json',
    JSON.stringify({ schema_version: 1, UUID: 'AB'.repeat(32), created_at: 'x', telemetry_consent: true }),
    JSON.stringify({ schema_version: 1, UUID: VALID_UUID, telemetry_consent: true }),
    JSON.stringify({ schema_version: 2, telemetry_consent: true }),
  ];
  for (const text of invalid) {
    const home = scratchDir(t, 'invalid-home');
    writeRecord(home, text);
    const record = hook.ensureInstance(home);
    assert.equal(record.UUID, hook.NIL_UUID_SENTINEL, text);
    assert.equal(record.telemetry_consent, false, text);
    const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
    assertSilent(result);
    assert.equal(requests.length, 0, text);
    assert.equal(fs.readFileSync(recordPath(home), 'utf8'), text);
  }
});

test('a newer-schema record keeps its UUID but fails closed on consent', (t) => {
  const home = scratchDir(t, 'newer-home');
  writeRecord(home, { schema_version: 2, UUID: VALID_UUID, telemetry_consent: true });
  assert.deepEqual(hook.ensureInstance(home), { UUID: VALID_UUID, telemetry_consent: false });
});

// ── Endpoint ─────────────────────────────────────────────────────────────

test('KONDUCTOR_METRICS_ENDPOINT overrides the default when it passes the allowlist', (t) => {
  const allowed = runHook(t, { ...AGENT_EVENT, env: { KONDUCTOR_METRICS_ENDPOINT: 'https://collector.example.com/in' } });
  assert.equal(allowed.requests.length, 1);
  assert.equal(allowed.requests[0].url, 'https://collector.example.com/in');
  for (const endpoint of ['http://collector.example.com/in', 'https://127.0.0.1/in', 'https://x@localhost/in', 'https://[::1]/in']) {
    const { result, requests } = runHook(t, { ...AGENT_EVENT, env: { KONDUCTOR_METRICS_ENDPOINT: endpoint } });
    assertSilent(result);
    assert.equal(requests.length, 0, endpoint);
  }
});

test('host allowlist matches the CLI ranges', () => {
  const disallowed = [
    'localhost', 'LocalHost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.255', '::', '::1', 'fe80::1', 'febf::1',
    'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::10.0.0.1', '2002:7f00:1::',
    '64:ff9b::a00:1', '64:ff9b::192.168.0.1',
  ];
  const allowed = [
    'metrics.awssolutionsbuilder.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2001:db8::1',
    '::ffff:808:808', '2002:808:808::', '64:ff9b::808:808',
  ];
  for (const host of disallowed) {
    assert.equal(hook.isDisallowedHost(host), true, host);
  }
  for (const host of allowed) {
    assert.equal(hook.isDisallowedHost(host), false, host);
  }
});

// ── Bad input ────────────────────────────────────────────────────────────

test('bad input prints nothing and exits 0', (t) => {
  const cases = [
    { eventType: 'agent-invocation', stdin: 'not json at all' },
    { eventType: 'agent-invocation', stdin: '' },
    { eventType: 'agent-invocation', stdin: '[1,2,3]' },
    { eventType: 'agent-invocation', stdin: 'null' },
    { eventType: 'subagent-invocation', stdin: '{"agent_type": 42, "session_id": {}}' },
    { eventType: 'agent-invocation', stdin: JSON.stringify({ agent_type: 'konductor', pad: 'x'.repeat(70 * 1024) }) },
    { eventType: 'bogus-event', stdin: JSON.stringify({ agent_type: 'konductor' }) },
    { eventType: undefined, stdin: JSON.stringify({ agent_type: 'konductor' }) },
  ];
  for (const testCase of cases) {
    const { result, requests } = runHook(t, testCase);
    assertSilent(result);
    assert.equal(requests.length, 0, JSON.stringify(testCase.eventType));
  }
});

test('an unwritable HOME prints nothing and exits 0', (t) => {
  const home = path.join(scratchDir(t, 'file-home'), 'not-a-dir');
  fs.writeFileSync(home, 'x');
  const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
  assertSilent(result);
  assert.equal(requests.length, 0);
});

// ── hooks.json ───────────────────────────────────────────────────────────

test('rendered hooks.json wires both events and matches every plugin agent', (t) => {
  const plugin = makePluginTree(t);
  const output = path.join(plugin, 'hooks', 'hooks.json');
  const render = spawnSync(
    'python3',
    [HOOKS_RENDERER, '--agents-dir', path.join(plugin, 'agents'), '--plugin-json', path.join(plugin, '.claude-plugin', 'plugin.json'), '--output', output],
    { encoding: 'utf8' },
  );
  assert.equal(render.status, 0, render.stderr);
  const { hooks } = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'SubagentStart']);
  assert.equal(hooks.SessionStart[0].matcher, 'startup|clear');
  for (const [event, arg] of [['SessionStart', 'agent-invocation'], ['SubagentStart', 'subagent-invocation']]) {
    const [handler] = hooks[event][0].hooks;
    assert.equal(handler.type, 'command');
    assert.equal(handler.async, true);
    assert.equal(handler.command, `node "\${CLAUDE_PLUGIN_ROOT}/hooks/konductor-telemetry.js" ${arg}`);
  }
  const matcher = new RegExp(hooks.SubagentStart[0].matcher, 'u');
  for (const agent of AGENTS) {
    assert.ok(matcher.test(agent), agent);
    assert.ok(matcher.test(`konductor:${agent}`), agent);
  }
  for (const other of ['Explore', 'other:konductor', 'konductor:k-architect-x', 'k-architec']) {
    assert.equal(matcher.test(other), false, other);
  }
});

test('hooks.json rendering fails when an agent name differs from its file name', (t) => {
  const plugin = makePluginTree(t);
  fs.writeFileSync(path.join(plugin, 'agents', 'k-developer.md'), '---\nname: someone-else\n---\n');
  const render = spawnSync(
    'python3',
    [HOOKS_RENDERER, '--agents-dir', path.join(plugin, 'agents'), '--plugin-json', path.join(plugin, '.claude-plugin', 'plugin.json'), '--output', path.join(plugin, 'out.json')],
    { encoding: 'utf8' },
  );
  assert.notEqual(render.status, 0);
});
