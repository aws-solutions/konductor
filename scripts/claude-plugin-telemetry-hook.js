#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Claude Code plugin telemetry hook, copied to hooks/konductor-telemetry.js
// in the published plugin tree. The plugin ships no konductor binary, so
// this is a dependency-free port of `konductor __telemetry-hook` for the two
// Claude Code events it handles:
//
//   node konductor-telemetry.js agent-invocation     (SessionStart)
//   node konductor-telemetry.js subagent-invocation  (SubagentStart)
//
// It reads the hook payload from stdin, prints nothing, and always exits 0.
// SessionStart stdout becomes model context, so any output would be a bug.
//
// Wire format and rules mirror cli/konductor-rs/src/cli/telemetry_hook.rs,
// cli/konductor-rs/src/cli/telemetry/{report,envelope}.rs and
// shared/konductor-telemetry/src/identity.rs, so plugin and CLI events line
// up and share one machine identity in ~/.konductor/telemetry.json.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SOLUTION_ID = 'SO0370';
const DEFAULT_TELEMETRY_ENDPOINT = 'https://metrics.awssolutionsbuilder.com/generic';
const NIL_UUID_SENTINEL = '0'.repeat(64);
// Tells plugin events apart from the CLI's, which send null on agent events.
const HARNESS = 'claude-plugin';
const INSTANCE_SCHEMA_VERSION = 1;
const MAX_HOOK_PAYLOAD_BYTES = 64 * 1024;
const SEND_TIMEOUT_MS = 3000;
const AGENT_INVOCATION = 'agent-invocation';
const SUBAGENT_INVOCATION = 'subagent-invocation';
const DEFAULT_PLUGIN_NAME = 'konductor';

const PLUGIN_ROOT = path.resolve(__dirname, '..');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function isValidUuidShape(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isoMillis(date) {
  return date.toISOString();
}

// The outer envelope's "YYYY-MM-DD HH:MM:SS.f" shape (tenths of a second).
function wireTimestamp(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${iso.slice(20, 21)}`;
}

function epochNanos() {
  return BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n);
}

function hashPresentSessionId(uuid, rawSessionId) {
  const raw = nonEmptyString(rawSessionId);
  return raw === null ? null : sha256Hex(`${uuid}${raw}`);
}

function buildEventBody({
  eventType,
  targetName,
  uuid,
  version,
  sessionId = null,
  parentSessionId = null,
  parentAgentName = null,
  now = new Date(),
}) {
  return {
    Solution: SOLUTION_ID,
    Version: version,
    UUID: uuid,
    TimeStamp: wireTimestamp(now),
    Data: {
      // Rust passes the nil sentinel as eventId entropy for agent events.
      eventId: sha256Hex(`${NIL_UUID_SENTINEL}-${epochNanos()}-${process.pid}`),
      eventType,
      targetName,
      sessionId: hashPresentSessionId(uuid, sessionId),
      parentSessionId: hashPresentSessionId(uuid, parentSessionId),
      parentAgentName: nonEmptyString(parentAgentName),
      errorCode: null,
      harness: HARNESS,
      agentVersion: null,
      TimeStamp: isoMillis(now),
    },
  };
}

// ── Consent ──────────────────────────────────────────────────────────────

function telemetryOffByEnv(env) {
  return env.KONDUCTOR_TELEMETRY === 'off';
}

// Minimal read of `telemetry.enabled` from .konductor/config.yml: a block
// mapping under a top-level `telemetry:` key, or a one-line flow mapping.
function configDisablesTelemetry(text) {
  const isFalse = (value) => ['false', 'False', 'FALSE'].includes(value);
  let inSection = false;
  let childIndent = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').replace(/\s+$/, '');
    if (line.trim() === '' || line === '---') {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      const top = /^telemetry\s*:\s*(.*)$/.exec(line);
      inSection = top !== null;
      childIndent = null;
      if (top && top[1].startsWith('{')) {
        const flow = /[{,]\s*enabled\s*:\s*([^,}\s]+)\s*[,}]/.exec(top[1]);
        if (flow && isFalse(flow[1])) {
          return true;
        }
      }
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (childIndent === null) {
      childIndent = indent;
    }
    if (indent !== childIndent) {
      continue;
    }
    const entry = /^\s+enabled\s*:\s*(\S+)$/.exec(line);
    if (entry && isFalse(entry[1])) {
      return true;
    }
  }
  return false;
}

function telemetryOffByConfig(cwd) {
  try {
    const text = fs.readFileSync(path.join(cwd, '.konductor', 'config.yml'), 'utf8');
    return configDisablesTelemetry(text);
  } catch {
    return false;
  }
}

// Plugin userConfig `telemetry_enabled`, exported by Claude Code to hooks.
function telemetryOffByPluginOption(env) {
  const value = env.CLAUDE_PLUGIN_OPTION_TELEMETRY_ENABLED;
  if (typeof value !== 'string') {
    return false;
  }
  return ['false', '0', 'off', 'no'].includes(value.trim().toLowerCase());
}

// ── Machine identity (~/.konductor/telemetry.json) ───────────────────────

function homeDir(env) {
  const home = nonEmptyString(env.HOME);
  if (home !== null) {
    return home;
  }
  // The CLI anchors on $HOME only; Windows rarely sets it.
  return process.platform === 'win32' ? nonEmptyString(os.homedir()) : null;
}

function instancePath(home) {
  return path.join(home, '.konductor', 'telemetry.json');
}

// Same outcomes as identity.rs `read_instance_raw`: ok, newer, or absent.
function readInstanceRaw(home) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(instancePath(home), 'utf8'));
  } catch {
    return { kind: 'absent' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'absent' };
  }
  const schemaVersion = value.schema_version;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    return { kind: 'absent' };
  }
  if (schemaVersion > INSTANCE_SCHEMA_VERSION) {
    return { kind: 'newer', uuid: isValidUuidShape(value.UUID) ? value.UUID : null };
  }
  if (
    schemaVersion !== INSTANCE_SCHEMA_VERSION ||
    !isValidUuidShape(value.UUID) ||
    typeof value.created_at !== 'string' ||
    typeof value.telemetry_consent !== 'boolean'
  ) {
    return { kind: 'absent' };
  }
  return {
    kind: 'ok',
    record: {
      schema_version: schemaVersion,
      UUID: value.UUID,
      created_at: value.created_at,
      telemetry_consent: value.telemetry_consent,
    },
  };
}

function failClosed(uuid = NIL_UUID_SENTINEL) {
  return { UUID: uuid, telemetry_consent: false };
}

function fromReadOutcome(outcome) {
  if (outcome.kind === 'ok') {
    return outcome.record;
  }
  if (outcome.kind === 'newer') {
    return failClosed(outcome.uuid || NIL_UUID_SENTINEL);
  }
  return null;
}

function createPrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    return;
  }
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('not a real directory');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('directory owned by another user');
  }
  fs.chmodSync(dir, 0o700);
}

let tempCounter = 0;

// Mirrors identity.rs `ensure_instance`: publish with link(2) so a racing
// writer can't be overwritten, and never repair or replace an existing file.
// An unreadable record fails closed (nil UUID, no consent) for this call.
function ensureInstance(home, now = new Date()) {
  const existing = fromReadOutcome(readInstanceRaw(home));
  if (existing !== null) {
    return existing;
  }
  const dir = path.join(home, '.konductor');
  try {
    createPrivateDir(dir);
  } catch {
    return failClosed();
  }
  const record = {
    schema_version: INSTANCE_SCHEMA_VERSION,
    UUID: crypto.randomBytes(32).toString('hex'),
    created_at: isoMillis(now),
    telemetry_consent: true,
  };
  const tmp = path.join(dir, `telemetry.json.tmp-${process.pid}-${tempCounter++}`);
  try {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // No leftover temp file.
    }
    const flags =
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
    const fd = fs.openSync(tmp, flags, 0o600);
    try {
      if (process.platform !== 'win32') {
        fs.fchmodSync(fd, 0o600);
      }
      fs.writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.linkSync(tmp, instancePath(home));
      return record;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        return fromReadOutcome(readInstanceRaw(home)) || failClosed();
      }
      return failClosed();
    }
  } catch {
    return failClosed();
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Already gone.
    }
  }
}

// ── Endpoint allowlist (same rules as konductor-telemetry-report.sh) ─────

function parseIpv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) {
    return null;
  }
  return parts.map(Number);
}

function parseIpv6(text) {
  let head = text;
  let tail = [];
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) {
      return null;
    }
    head = text.slice(0, lastColon + 1);
    if (head.endsWith(':') && !head.endsWith('::')) {
      head = head.slice(0, -1);
    }
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
  }
  const hextets = (part) => (part === '' ? [] : part.split(':').map((h) => parseInt(h, 16)));
  const halves = head.split('::');
  if (halves.length > 2) {
    return null;
  }
  const left = hextets(halves[0]);
  const right = halves.length === 2 ? hextets(halves[1]) : [];
  const fill = 8 - left.length - right.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) {
    return null;
  }
  const segments = [...left, ...new Array(fill).fill(0), ...right, ...tail];
  return segments.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffff) ? segments : null;
}

function isDisallowedIpv4([a, b]) {
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && (b & 0xc0) === 0x40)
  );
}

function embeddedIpv4(hi, lo) {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isDisallowedIpv6(s) {
  const zeroThrough = (n) => s.slice(0, n).every((x) => x === 0);
  if (zeroThrough(5) && s[5] === 0xffff) {
    return isDisallowedIpv4(embeddedIpv4(s[6], s[7]));
  }
  if (zeroThrough(6)) {
    // `::` and `::1`; anything else here is the IPv4-compatible form.
    if (s[6] === 0 && (s[7] === 0 || s[7] === 1)) {
      return true;
    }
    return isDisallowedIpv4(embeddedIpv4(s[6], s[7]));
  }
  if (s[0] === 0x2002) {
    return isDisallowedIpv4(embeddedIpv4(s[1], s[2]));
  }
  if (s[0] === 0x64 && s[1] === 0xff9b && s.slice(2, 6).every((x) => x === 0)) {
    return isDisallowedIpv4(embeddedIpv4(s[6], s[7]));
  }
  return (s[0] & 0xffc0) === 0xfe80 || (s[0] & 0xfe00) === 0xfc00;
}

function isDisallowedHost(host) {
  if (host.toLowerCase() === 'localhost') {
    return true;
  }
  if (net.isIPv4(host)) {
    return isDisallowedIpv4(parseIpv4(host));
  }
  if (net.isIPv6(host)) {
    const segments = parseIpv6(host);
    return segments === null || isDisallowedIpv6(segments);
  }
  return false;
}

// No DNS resolution or pinning here, unlike the CLI: a hostname that
// resolves to a private address is not caught.
function resolveEndpoint(env) {
  const candidate = nonEmptyString(env.KONDUCTOR_METRICS_ENDPOINT) || DEFAULT_TELEMETRY_ENDPOINT;
  if (!candidate.startsWith('https://')) {
    return null;
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') {
    return null;
  }
  if (!nonEmptyString(env.KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT)) {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    if (isDisallowedHost(host)) {
      return null;
    }
  }
  return url;
}

// ── Agent names ──────────────────────────────────────────────────────────

function readPluginManifest(pluginRoot) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    const version = nonEmptyString(manifest.version);
    if (version === null) {
      return null;
    }
    return { name: nonEmptyString(manifest.name) || DEFAULT_PLUGIN_NAME, version };
  } catch {
    return null;
  }
}

function konductorAgentNames(pluginRoot) {
  try {
    return new Set(
      fs
        .readdirSync(path.join(pluginRoot, 'agents'))
        .filter((file) => file.endsWith('.md') && !file.startsWith('_'))
        .map((file) => file.slice(0, -'.md'.length)),
    );
  } catch {
    return new Set();
  }
}

// Claude Code reports plugin agents as `<plugin>:<agent>`. A bare name
// belongs to a CLI install, whose own hook reports it. Returns the bare
// name, or null when the agent isn't one of this plugin's.
function konductorAgentName(raw, pluginName, agents) {
  const value = nonEmptyString(raw);
  const prefix = `${pluginName}:`;
  if (value === null || !value.startsWith(prefix)) {
    return null;
  }
  const bare = value.slice(prefix.length);
  return agents.has(bare) ? bare : null;
}

// Mirrors the Claude rows of telemetry_hook.rs `resolve_invocations`.
function resolveInvocation(eventType, payload, env, pluginName, agents) {
  const sessionId = nonEmptyString(payload.session_id) || nonEmptyString(payload.sessionId);
  const agentType = nonEmptyString(payload.agent_type) || nonEmptyString(payload.agent_name);
  const agent = konductorAgentName(agentType, pluginName, agents);
  if (agent === null) {
    return null;
  }
  if (eventType === AGENT_INVOCATION) {
    return { eventType: 'agent_invocation', targetName: agent, sessionId, parentSessionId: null, parentAgentName: null };
  }
  if (eventType === SUBAGENT_INVOCATION) {
    return {
      eventType: 'subagent_invocation',
      targetName: agent,
      sessionId,
      parentSessionId: sessionId,
      parentAgentName: konductorAgentName(env.CLAUDE_CODE_AGENT, pluginName, agents),
    };
  }
  return null;
}

// ── Transport ────────────────────────────────────────────────────────────

function send(url, body) {
  return new Promise((resolve) => {
    let request;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (request) {
        request.destroy();
      }
      done();
    }, SEND_TIMEOUT_MS);
    try {
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      request = https.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        timeout: SEND_TIMEOUT_MS,
      });
      request.on('response', (response) => {
        response.resume();
        response.on('end', done);
        response.on('error', done);
      });
      request.on('timeout', () => request.destroy());
      request.on('error', done);
      request.on('close', done);
      request.end(payload);
    } catch {
      done();
    }
  });
}

function readStdinCapped() {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_HOOK_PAYLOAD_BYTES) {
        process.stdin.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(null));
  });
}

async function run(argv, env) {
  const eventType = argv[0];
  if (eventType !== AGENT_INVOCATION && eventType !== SUBAGENT_INVOCATION) {
    return;
  }
  const text = await readStdinCapped();
  if (text === null) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return;
  }

  if (telemetryOffByEnv(env)) {
    return;
  }
  const cwd = nonEmptyString(payload.cwd) || process.cwd();
  if (telemetryOffByConfig(cwd) || telemetryOffByPluginOption(env)) {
    return;
  }

  const manifest = readPluginManifest(PLUGIN_ROOT);
  if (manifest === null) {
    return;
  }
  const invocation = resolveInvocation(
    eventType,
    payload,
    env,
    manifest.name,
    konductorAgentNames(PLUGIN_ROOT),
  );
  if (invocation === null) {
    return;
  }
  const endpoint = resolveEndpoint(env);
  if (endpoint === null) {
    return;
  }
  const home = homeDir(env);
  if (home === null) {
    return;
  }
  const record = ensureInstance(home);
  if (!record.telemetry_consent) {
    return;
  }

  await send(endpoint, buildEventBody({ ...invocation, uuid: record.UUID, version: manifest.version }));
}

function main() {
  const quietExit = () => process.exit(0);
  process.on('uncaughtException', quietExit);
  process.on('unhandledRejection', quietExit);
  // Backstop in case stdin never closes.
  setTimeout(quietExit, SEND_TIMEOUT_MS + 2000).unref();
  run(process.argv.slice(2), process.env).then(quietExit, quietExit);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TELEMETRY_ENDPOINT,
  NIL_UUID_SENTINEL,
  SOLUTION_ID,
  buildEventBody,
  configDisablesTelemetry,
  ensureInstance,
  isDisallowedHost,
  konductorAgentName,
  readInstanceRaw,
  resolveEndpoint,
  resolveInvocation,
};
