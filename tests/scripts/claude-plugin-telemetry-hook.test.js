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
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOK_SOURCE = path.join(REPO_ROOT, 'scripts', 'claude-plugin-telemetry-hook.js');
const HOOKS_RENDERER = path.join(REPO_ROOT, 'scripts', 'render-claude-plugin-hooks-json.py');
const SCHEMA_PATH = path.join(REPO_ROOT, 'docs', 'telemetry-schema.json');
const REPORT_RS = path.join(REPO_ROOT, 'cli', 'konductor-rs', 'src', 'cli', 'telemetry', 'report.rs');
const TELEMETRY_HOOK_RS = path.join(REPO_ROOT, 'cli', 'konductor-rs', 'src', 'cli', 'telemetry_hook.rs');
const IDENTITY_RS = path.join(REPO_ROOT, 'shared', 'konductor-telemetry', 'src', 'identity.rs');
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
function runHook(t, { eventType, payload, env = {}, home, stdin, preload = [], setupPlugin, timeout = 15000 }) {
  const plugin = makePluginTree(t);
  if (setupPlugin) {
    setupPlugin(plugin);
  }
  const homeDir = home || scratchDir(t, 'home');
  const project = scratchDir(t, 'project');
  const stubOut = path.join(scratchDir(t, 'stub'), 'requests.jsonl');
  const input =
    stdin !== undefined ? stdin : JSON.stringify({ cwd: project, session_id: RAW_SESSION_ID, ...payload });
  const requires = [STUB, ...preload].flatMap((file) => ['--require', file]);
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [...requires, path.join(plugin, 'hooks', 'konductor-telemetry.js'), ...(eventType ? [eventType] : [])],
    {
      input,
      cwd: project,
      env: { PATH: process.env.PATH, HOME: homeDir, TELEMETRY_STUB_OUT: stubOut, ...env },
      encoding: 'utf8',
      timeout,
    },
  );
  const elapsed = Date.now() - started;
  const requests = fs.existsSync(stubOut)
    ? fs
        .readFileSync(stubOut, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
  return { result, requests, home: homeDir, project, elapsed };
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
    assert.equal(body.Data.harness, 'claude-plugin');
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

function rustConst(file, name) {
  const match = new RegExp(`const ${name}: [^=]+=\\s*([^;]+);`).exec(fs.readFileSync(file, 'utf8'));
  assert.ok(match, `${name} not found in ${path.relative(REPO_ROOT, file)}`);
  return match[1].trim();
}

test('identity and payload constants match the Rust sources', () => {
  assert.equal(hook.NIL_UUID_SENTINEL, JSON.parse(rustConst(IDENTITY_RS, 'NIL_UUID_SENTINEL')));
  assert.equal(hook.INSTANCE_SCHEMA_VERSION, Number(rustConst(IDENTITY_RS, 'INSTANCE_SCHEMA_VERSION')));
  const maxPayload = rustConst(TELEMETRY_HOOK_RS, 'MAX_HOOK_PAYLOAD_BYTES');
  assert.match(maxPayload, /^[\d\s*]+$/);
  assert.equal(hook.MAX_HOOK_PAYLOAD_BYTES, maxPayload.split('*').reduce((n, f) => n * Number(f), 1));
});

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

test('every event field matches its schema type and pattern', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const bodies = [
    hook.buildEventBody({ eventType: 'agent_invocation', targetName: 'konductor', uuid: VALID_UUID, version: '1', sessionId: RAW_SESSION_ID }),
    hook.buildEventBody({ eventType: 'agent_invocation', targetName: 'konductor', uuid: VALID_UUID, version: '1' }),
    hook.buildEventBody({
      eventType: 'subagent_invocation',
      targetName: 'k-developer',
      uuid: VALID_UUID,
      version: '1',
      sessionId: RAW_SESSION_ID,
      parentSessionId: RAW_SESSION_ID,
      parentAgentName: 'konductor',
    }),
  ];
  for (const { Data } of bodies) {
    for (const [key, value] of Object.entries(Data)) {
      const property = schema.properties[key];
      assert.ok(property, `${key} is not in the schema`);
      const types = [].concat(property.type);
      const actual = jsonType(value);
      assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `${key}: ${actual} not in ${types}`);
      if (typeof value === 'string' && property.pattern) {
        assert.match(value, new RegExp(property.pattern), key);
      }
      if (typeof value === 'string' && property.format === 'date-time') {
        assert.ok(!Number.isNaN(Date.parse(value)), key);
      }
    }
  }
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
  for (const parent of ['my-own-agent', 'other-plugin:konductor', 'konductor', undefined]) {
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
  for (const agentType of ['Explore', 'general-purpose', 'k-architect', 'konductor', 'other-plugin:k-architect', 'konductor:not-ours', 'konductor:', '']) {
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

function writeConfig(dir, text) {
  fs.mkdirSync(path.join(dir, '.konductor'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.konductor', 'config.yml'), text);
}

function agentEventIn(cwd) {
  return {
    eventType: 'agent-invocation',
    stdin: JSON.stringify({ cwd, session_id: RAW_SESSION_ID, agent_type: 'konductor:konductor' }),
  };
}

test('an opt-out in a parent directory of cwd suppresses sending', (t) => {
  const project = scratchDir(t, 'parent-config');
  writeConfig(project, 'telemetry:\n  enabled: false\n');
  const subdir = path.join(project, 'packages', 'app');
  fs.mkdirSync(subdir, { recursive: true });
  const { result, requests } = runHook(t, agentEventIn(subdir));
  assertSilent(result);
  assert.equal(requests.length, 0);
});

test('an opt-out in $HOME/.konductor/config.yml suppresses sending', (t) => {
  const home = scratchDir(t, 'home-config');
  writeConfig(home, 'telemetry:\n  enabled: false\n');
  const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
  assertSilent(result);
  assert.equal(requests.length, 0);
  assert.equal(fs.existsSync(recordPath(home)), false);
});

test('a nearer config with telemetry on does not override an opt-out further up', (t) => {
  const home = scratchDir(t, 'home-config-off');
  writeConfig(home, 'telemetry:\n  enabled: false\n');
  const project = scratchDir(t, 'project-config-on');
  writeConfig(project, 'telemetry:\n  enabled: true\n');
  const { requests } = runHook(t, { ...agentEventIn(project), home });
  assert.equal(requests.length, 0);
});

test('an unreadable config fails open, as the CLI does', (t) => {
  const asDirectory = scratchDir(t, 'config-dir');
  fs.mkdirSync(path.join(asDirectory, '.konductor', 'config.yml'), { recursive: true });
  assert.equal(runHook(t, agentEventIn(asDirectory)).requests.length, 1);
  if (process.platform !== 'win32' && process.getuid() !== 0) {
    const noRead = scratchDir(t, 'config-noread');
    writeConfig(noRead, 'telemetry:\n  enabled: false\n');
    fs.chmodSync(path.join(noRead, '.konductor', 'config.yml'), 0o000);
    assert.equal(runHook(t, agentEventIn(noRead)).requests.length, 1);
  }
});

test('config parser treats telemetry.enabled: false as off in every YAML form', () => {
  const off = {
    block: 'telemetry:\n  enabled: false\n',
    'block with comment': 'telemetry:\n  endpoint: https://x\n  enabled: false # off\n',
    'flow value': 'telemetry: {enabled: false}\n',
    'capitalized, deeper indent': 'other: 1\ntelemetry:\n    enabled: False\n',
    'quoted key': '"telemetry":\n  "enabled": false\n',
    'single-quoted key': "'telemetry':\n  'enabled': false\n",
    BOM: '\uFEFFtelemetry:\n  enabled: false\n',
    'flow top': '{telemetry: {enabled: false}}\n',
    JSON: '{"telemetry": {"enabled": false, "endpoint": "https://x/y"}}\n',
    'flow quoted': "telemetry: {'enabled': false}\n",
    'flow top quoted': "{'telemetry': {\"enabled\": false}}\n",
    'multi-line flow': 'telemetry: {\n  endpoint: https://x/y,\n  enabled: false\n}\n',
    '!!bool tag': 'telemetry:\n  enabled: !!bool false\n',
    'anchor and merge': 'defaults: &d\n  enabled: false\ntelemetry:\n  <<: *d\n',
    'quoted scalar': 'telemetry:\n  enabled: "false"\n',
    'duplicate key': 'telemetry:\n  enabled: true\n  enabled: false\n',
    'unclosed flow': 'telemetry: {enabled: true\n',
    'flow after ---': '--- {telemetry: {enabled: false}}\n',
    'uniform root indent': '  telemetry:\n    enabled: false\n',
    'indented after ---': '--- \n  telemetry:\n    enabled: false\n',
    'indented JSON': '  {\n  "telemetry": {\n    "enabled": false\n  }\n}\n',
    'complex key': '? telemetry\n: enabled: false\n',
  };
  const on = {
    block: 'telemetry:\n  enabled: true\n',
    'block with endpoint': 'telemetry:\n  endpoint: https://x/y # here\n  enabled: TRUE\n',
    JSON: '{"telemetry": {"enabled": true}}',
    'flow top': '{telemetry: {enabled: true, endpoint: https://x/y}}\n',
    BOM: '\uFEFFtelemetry:\n  enabled: true\n',
    'no enabled key': 'telemetry:\n  endpoint: https://x\n',
    'no telemetry key': 'enabled: false\n',
    'other section': 'other:\n  enabled: false\n',
    'nested enabled': 'telemetry:\n  nested:\n    enabled: false\n',
    'commented out': '# telemetry:\n#   enabled: false\n',
    'after ---': '--- \ntelemetry:\n  enabled: true\n',
    'flow after ---': '--- {telemetry: {enabled: true}}\n',
    empty: '',
  };
  for (const [name, text] of Object.entries(off)) {
    assert.equal(hook.configDisablesTelemetry(text), true, name);
  }
  for (const [name, text] of Object.entries(on)) {
    assert.equal(hook.configDisablesTelemetry(text), false, name);
  }
});

// ── File reads ───────────────────────────────────────────────────────────

const POSIX_ONLY = { skip: process.platform === 'win32' };

function mkfifo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const made = spawnSync('mkfifo', [file]);
  assert.equal(made.status, 0, 'mkfifo failed');
}

test('a FIFO config.yml is skipped without blocking the hook', POSIX_ONLY, (t) => {
  const project = scratchDir(t, 'fifo-config');
  mkfifo(path.join(project, '.konductor', 'config.yml'));
  const { result, requests, elapsed } = runHook(t, { ...agentEventIn(project), timeout: 8000 });
  assertSilent(result);
  assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  assert.equal(requests.length, 1);
});

test('a FIFO telemetry.json or plugin.json exits promptly and sends nothing', POSIX_ONLY, (t) => {
  const fifoHome = scratchDir(t, 'fifo-home');
  mkfifo(recordPath(fifoHome));
  const fifoManifest = (plugin) => {
    const manifest = path.join(plugin, '.claude-plugin', 'plugin.json');
    fs.rmSync(manifest);
    mkfifo(manifest);
  };
  for (const options of [{ home: fifoHome }, { setupPlugin: fifoManifest }]) {
    const { result, requests, elapsed } = runHook(t, { ...AGENT_EVENT, ...options, timeout: 8000 });
    assertSilent(result);
    assert.ok(elapsed < 3000, `took ${elapsed} ms`);
    assert.equal(requests.length, 0);
  }
});

test('a config.yml over 64 KiB is treated as unreadable', (t) => {
  const optOut = 'telemetry:\n  enabled: false\n';
  const atCap = scratchDir(t, 'config-at-cap');
  writeConfig(atCap, optOut + '#'.repeat(64 * 1024 - optOut.length - 1) + '\n');
  assert.equal(runHook(t, agentEventIn(atCap)).requests.length, 0);
  const overCap = scratchDir(t, 'config-over-cap');
  writeConfig(overCap, optOut + '#'.repeat(64 * 1024 - optOut.length) + '\n');
  assert.equal(runHook(t, agentEventIn(overCap)).requests.length, 1);
});

test('an oversized telemetry.json fails closed and is left alone', (t) => {
  const home = scratchDir(t, 'big-record-home');
  const text = writeRecord(home, {
    schema_version: 1,
    UUID: VALID_UUID,
    created_at: '2026-01-01T00:00:00.000Z',
    telemetry_consent: true,
    pad: 'x'.repeat(64 * 1024),
  });
  const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
  assertSilent(result);
  assert.equal(requests.length, 0);
  assert.equal(fs.readFileSync(recordPath(home), 'utf8'), text);
});

test('a non-Konductor session opens no config files', (t) => {
  const traceDir = scratchDir(t, 'trace');
  const traceOut = path.join(traceDir, 'opened.txt');
  const tracer = path.join(traceDir, 'trace-config-reads.js');
  fs.writeFileSync(
    tracer,
    `'use strict';
const fs = require('node:fs');
for (const name of ['openSync', 'readFileSync', 'statSync', 'existsSync']) {
  const original = fs[name];
  fs[name] = function (file, ...rest) {
    if (String(file).endsWith('config.yml')) {
      fs.appendFileSync(${JSON.stringify(traceOut)}, String(file) + '\\n');
    }
    return original.call(this, file, ...rest);
  };
}
`,
  );
  const project = scratchDir(t, 'traced-project');
  writeConfig(project, 'telemetry:\n  enabled: true\n');
  const opened = () => (fs.existsSync(traceOut) ? fs.readFileSync(traceOut, 'utf8') : '');
  const stdin = (agentType) => JSON.stringify({ cwd: project, session_id: RAW_SESSION_ID, agent_type: agentType });

  const other = runHook(t, { eventType: 'agent-invocation', stdin: stdin('Explore'), preload: [tracer] });
  assertSilent(other.result);
  assert.equal(opened(), '');

  const ours = runHook(t, { eventType: 'agent-invocation', stdin: stdin('konductor:konductor'), preload: [tracer] });
  assert.equal(ours.requests.length, 1);
  assert.notEqual(opened(), '', 'the tracer saw no reads at all');
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

test('creates ~/.konductor with mode 0700', { skip: process.platform === 'win32' }, (t) => {
  const { requests, home } = runHook(t, AGENT_EVENT);
  assert.equal(requests.length, 1);
  assert.equal(fs.lstatSync(path.join(home, '.konductor')).mode & 0o777, 0o700);
});

test('a symlinked ~/.konductor sends nothing and writes nothing into the target', { skip: process.platform === 'win32' }, (t) => {
  const home = scratchDir(t, 'symlink-home');
  const target = scratchDir(t, 'symlink-target');
  fs.symlinkSync(target, path.join(home, '.konductor'));
  const { result, requests } = runHook(t, { ...AGENT_EVENT, home });
  assertSilent(result);
  assert.equal(requests.length, 0);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(fs.lstatSync(path.join(home, '.konductor')).isSymbolicLink(), true);
});

function withWriteSync(t, replacement) {
  const original = fs.writeSync;
  fs.writeSync = (fd, data, ...rest) => replacement(original, fd, data, ...rest);
  t.after(() => {
    fs.writeSync = original;
  });
}

test('a short write still publishes the whole record', (t) => {
  const home = scratchDir(t, 'short-write-home');
  withWriteSync(t, (original, fd, data, offset = 0, length) => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    return original(fd, bytes, offset, Math.min(7, length ?? bytes.length - offset));
  });
  const record = hook.ensureInstance(home);
  assert.equal(record.telemetry_consent, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(recordPath(home), 'utf8')), record);
});

test('a write that makes no progress fails closed and publishes nothing', (t) => {
  const home = scratchDir(t, 'stalled-write-home');
  withWriteSync(t, () => 0);
  assert.deepEqual(hook.ensureInstance(home), { UUID: hook.NIL_UUID_SENTINEL, telemetry_consent: false });
  assert.equal(fs.existsSync(recordPath(home)), false);
  assert.deepEqual(fs.readdirSync(path.join(home, '.konductor')), []);
});

// ── Failure handling ─────────────────────────────────────────────────────

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

test('a request that never responds is dropped after SEND_TIMEOUT_MS', (t) => {
  const { result, requests, elapsed } = runHook(t, { ...AGENT_EVENT, env: { TELEMETRY_STUB_MODE: 'hang' } });
  assertSilent(result);
  assert.equal(requests.length, 1);
  assert.ok(elapsed >= hook.SEND_TIMEOUT_MS - 200 && elapsed < hook.SEND_TIMEOUT_MS + 1500, `took ${elapsed} ms`);
});

test('stdin that never closes still exits 0 through the backstop', async (t) => {
  const plugin = makePluginTree(t);
  const stubOut = path.join(scratchDir(t, 'stub'), 'requests.jsonl');
  const started = Date.now();
  const child = spawn(process.execPath, ['--require', STUB, path.join(plugin, 'hooks', 'konductor-telemetry.js'), 'agent-invocation'], {
    cwd: scratchDir(t, 'project'),
    env: { PATH: process.env.PATH, HOME: scratchDir(t, 'home'), TELEMETRY_STUB_OUT: stubOut },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const killer = setTimeout(() => child.kill('SIGKILL'), 10000);
  const [code] = await once(child, 'exit');
  clearTimeout(killer);
  child.stdin.destroy();
  const elapsed = Date.now() - started;
  assert.equal(code, 0);
  assert.ok(elapsed < hook.SEND_TIMEOUT_MS + 3500, `took ${elapsed} ms`);
  assert.equal(fs.existsSync(stubOut), false);
});

test('the endpoint is fixed: KONDUCTOR_METRICS_ENDPOINT and telemetry.endpoint are ignored', (t) => {
  const project = scratchDir(t, 'endpoint-config');
  writeConfig(project, 'telemetry:\n  enabled: true\n  endpoint: https://config.example/generic\n');
  const { requests } = runHook(t, { ...agentEventIn(project), env: { KONDUCTOR_METRICS_ENDPOINT: 'https://x.example/' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, hook.DEFAULT_TELEMETRY_ENDPOINT);
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
    assert.ok(matcher.test(`konductor:${agent}`), agent);
    assert.equal(matcher.test(agent), false, `bare ${agent}`);
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

test('a config without telemetry.enabled leaves telemetry on, as the CLI does', () => {
  const { configDisablesTelemetry } = require('../../scripts/claude-plugin-telemetry-hook.js');
  assert.equal(configDisablesTelemetry('telemetry:\n  endpoint: https://metrics.example.com/generic\nmcp:\n  enabled: true\n'), false);
  assert.equal(configDisablesTelemetry('{"telemetry": {"endpoint": "x"}, "mcp": {"enabled": true}}\n'), false);
  assert.equal(configDisablesTelemetry('mcp:\n  enabled: false\n'), false);
});

test('comments do not affect the telemetry.enabled reading', () => {
  const { configDisablesTelemetry } = require('../../scripts/claude-plugin-telemetry-hook.js');
  assert.equal(configDisablesTelemetry('telemetry:\n  enabled: true  # see **docs**\n'), false);
  assert.equal(configDisablesTelemetry('# telemetry enabled: false\nmcp: {}\n'), false);
  assert.equal(configDisablesTelemetry('telemetry:\n  enabled: false  # opted out\n'), true);
});
