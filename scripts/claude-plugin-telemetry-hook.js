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
const dns = require('node:dns');
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
const DNS_TIMEOUT_MS = 500;
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

const TRUE_SCALARS = ['true', 'True', 'TRUE'];
const FALSE_SCALARS = ['false', 'False', 'FALSE'];

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

// Turns a YAML flow mapping (or JSON) into JSON text. Plain scalars become
// strings except booleans, null and numbers. A `:` only splits a key from its
// value when followed by a space or after a quoted key, so URLs stay whole.
function flowToJson(text) {
  const out = [];
  let i = 0;
  let afterQuoted = false;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if ('{}[],'.includes(c)) {
      out.push(c);
      afterQuoted = false;
      i++;
    } else if (c === ':' && (afterQuoted || i + 1 === text.length || /[\s,}\]]/.test(text[i + 1]))) {
      out.push(':');
      afterQuoted = false;
      i++;
    } else if (c === '"') {
      const end = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i));
      if (!end) {
        return null;
      }
      out.push(end[0]);
      afterQuoted = true;
      i += end[0].length;
    } else if (c === "'") {
      const end = /^'(?:[^']|'')*'/.exec(text.slice(i));
      if (!end) {
        return null;
      }
      out.push(JSON.stringify(end[0].slice(1, -1).replace(/''/g, "'")));
      afterQuoted = true;
      i += end[0].length;
    } else {
      let j = i;
      while (j < text.length && !',{}[]'.includes(text[j]) && !(text[j] === ':' && (j + 1 === text.length || /[\s,}\]]/.test(text[j + 1])))) {
        j++;
      }
      const plain = text.slice(i, j).trim();
      if (TRUE_SCALARS.includes(plain)) {
        out.push('true');
      } else if (FALSE_SCALARS.includes(plain)) {
        out.push('false');
      } else if (plain === 'null' || plain === '~') {
        out.push('null');
      } else if (/^-?\d+(\.\d+)?$/.test(plain)) {
        out.push(plain);
      } else {
        out.push(JSON.stringify(plain));
      }
      afterQuoted = false;
      i = j;
    }
  }
  return out.join('');
}

function parseFlow(text) {
  const json = flowToJson(text);
  if (json === null) {
    return undefined;
  }
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

const KEY_LINE = /^(\s*)(?:"([^"]*)"|'([^']*)'|([^\s'"{[#][^:]*?))\s*:(?:\s+(.*))?$/;

// `telemetry.enabled` from the top level of a block mapping: true, false,
// or undefined when it can't be read with confidence.
function blockEnabled(lines) {
  let section = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = KEY_LINE.exec(line);
    if (match === null) {
      if (line.trimStart().startsWith('-') && section !== null) {
        return undefined;
      }
      continue;
    }
    const [, indent, dq, sq, plain, rest = ''] = match;
    const key = dq ?? sq ?? plain;
    if (indent === '') {
      if (key !== 'telemetry') {
        if (section !== null) {
          section.done = true;
        }
        continue;
      }
      if (section !== null) {
        return undefined;
      }
      section = { values: [], childIndent: null, done: false };
      if (rest.startsWith('{')) {
        let flow = rest;
        while (!balanced(flow) && index + 1 < lines.length) {
          flow += `\n${lines[++index]}`;
        }
        const value = parseFlow(flow);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          return undefined;
        }
        if (Object.hasOwn(value, 'enabled')) {
          section.values.push(value.enabled);
        }
        section.done = true;
      } else if (rest !== '') {
        return undefined;
      }
      continue;
    }
    if (section === null || section.done) {
      continue;
    }
    if (section.childIndent === null) {
      section.childIndent = indent.length;
    }
    if (indent.length === section.childIndent && key === 'enabled') {
      section.values.push(TRUE_SCALARS.includes(rest) ? true : FALSE_SCALARS.includes(rest) ? false : rest);
    }
  }
  if (section === null || section.values.length === 0) {
    return null;
  }
  return section.values.length === 1 && typeof section.values[0] === 'boolean' ? section.values[0] : undefined;
}

function balanced(text) {
  let depth = 0;
  for (const c of text) {
    depth += '{['.includes(c) ? 1 : '}]'.includes(c) ? -1 : 0;
  }
  return depth <= 0;
}

// Reads `telemetry.enabled` from .konductor/config.yml. A missing setting
// leaves telemetry on, as in the CLI. Fails closed: if `enabled` is set but
// not plainly to true, telemetry is treated as off. YAML tags, anchors,
// aliases and merge keys are never interpreted.
function configDisablesTelemetry(rawText) {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => stripComment(line).replace(/\s+$/, ''))
    .filter((line) => line.trim() !== '' && !/^(---|\.\.\.)$/.test(line));
  const body = lines.join('\n');
  if (!/telemetry/i.test(body) || !/enabled/i.test(body)) {
    return false;
  }
  if (/(^|[\s:,[{-])[&*!]|<</.test(body)) {
    return true;
  }
  let enabled;
  if (lines[0].startsWith('{')) {
    const value = parseFlow(body);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return true;
    }
    const section = value.telemetry;
    if (section === undefined) {
      return false;
    }
    if (section === null || typeof section !== 'object' || Array.isArray(section)) {
      return true;
    }
    enabled = Object.hasOwn(section, 'enabled') ? section.enabled : null;
  } else {
    enabled = blockEnabled(lines);
  }
  return enabled !== null && enabled !== true;
}

function configPaths(cwd, home) {
  const dirs = [];
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    dirs.push(dir);
    if (path.dirname(dir) === dir) {
      break;
    }
  }
  if (home !== null && !dirs.includes(path.resolve(home))) {
    dirs.push(path.resolve(home));
  }
  return dirs.map((dir) => path.join(dir, '.konductor', 'config.yml'));
}

// Nearest first, as the CLI walks install roots, then $HOME. An unreadable
// file is skipped, as the CLI's read_telemetry_config does.
function telemetryOffByConfig(cwd, home) {
  return configPaths(cwd, home).some((file) => {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return false;
    }
    return configDisablesTelemetry(text);
  });
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

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!(written > 0)) {
      throw new Error('short write');
    }
    offset += written;
  }
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
      writeAll(fd, Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8'));
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

function isDisallowedHost(rawHost) {
  const host = rawHost.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
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

function allowLocalEndpoint(env) {
  return nonEmptyString(env.KONDUCTOR_TELEMETRY_ALLOW_LOCAL_ENDPOINT) !== null;
}

// Like the CLI's endpoint_host_is_allowed_with_pin: the host is checked
// here, and its resolved addresses are checked by checkedLookup when the
// request connects.
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
  if (!allowLocalEndpoint(env)) {
    const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
    if (isDisallowedHost(host)) {
      return null;
    }
  }
  return url;
}

// A `lookup` for https.request: resolves every address, refuses the
// connection if any is disallowed, and hands the socket the address it
// checked, so a second resolution can't swap it. A slow resolver is denied,
// as in the CLI.
function checkedLookup(lookupAll = (...args) => dns.lookup(...args), timeoutMs = DNS_TIMEOUT_MS) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    let settled = false;
    const finish = (err, chosen) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        callback(err);
      } else if (options && options.all) {
        callback(null, [chosen]);
      } else {
        callback(null, chosen.address, chosen.family);
      }
    };
    const timer = setTimeout(() => finish(new Error('DNS lookup timed out')), timeoutMs);
    lookupAll(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        finish(err);
      } else if (!Array.isArray(addresses) || addresses.length === 0) {
        finish(new Error('no addresses'));
      } else if (addresses.some(({ address }) => net.isIP(String(address)) === 0 || isDisallowedHost(String(address)))) {
        finish(new Error('endpoint resolves to a disallowed address'));
      } else {
        finish(null, addresses[0]);
      }
    });
  };
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

function send(url, body, env) {
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
    }, DNS_TIMEOUT_MS + SEND_TIMEOUT_MS);
    try {
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        timeout: SEND_TIMEOUT_MS,
      };
      if (!allowLocalEndpoint(env)) {
        options.lookup = checkedLookup();
      }
      request = https.request(url, options);
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
  const home = homeDir(env);
  const cwd = nonEmptyString(payload.cwd) || process.cwd();
  if (telemetryOffByConfig(cwd, home) || telemetryOffByPluginOption(env)) {
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
  if (home === null) {
    return;
  }
  const record = ensureInstance(home);
  if (!record.telemetry_consent) {
    return;
  }

  await send(endpoint, buildEventBody({ ...invocation, uuid: record.UUID, version: manifest.version }), env);
}

function main() {
  const quietExit = () => process.exit(0);
  process.on('uncaughtException', quietExit);
  process.on('unhandledRejection', quietExit);
  // Backstop in case stdin never closes.
  setTimeout(quietExit, DNS_TIMEOUT_MS + SEND_TIMEOUT_MS + 2000).unref();
  run(process.argv.slice(2), process.env).then(quietExit, quietExit);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TELEMETRY_ENDPOINT,
  INSTANCE_SCHEMA_VERSION,
  MAX_HOOK_PAYLOAD_BYTES,
  NIL_UUID_SENTINEL,
  SOLUTION_ID,
  buildEventBody,
  checkedLookup,
  configDisablesTelemetry,
  ensureInstance,
  isDisallowedHost,
  konductorAgentName,
  readInstanceRaw,
  resolveEndpoint,
  resolveInvocation,
};
