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
// The wire format matches cli/konductor-rs/src/cli/telemetry/envelope.rs, so
// plugin and CLI events line up. Both use the machine identity in
// ~/.konductor/telemetry.json.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const SOLUTION_ID = 'SO0370';
const DEFAULT_TELEMETRY_ENDPOINT = 'https://metrics.awssolutionsbuilder.com/generic';
const NIL_UUID_SENTINEL = '0'.repeat(64);
// Tells plugin events apart from the CLI's, which send null on agent events.
const HARNESS = 'claude-plugin';
const INSTANCE_SCHEMA_VERSION = 1;
const MAX_HOOK_PAYLOAD_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 64 * 1024;
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

// Returns the text of a regular file of at most MAX_FILE_BYTES, else null.
// O_NONBLOCK stops a FIFO from blocking the open, which would also stall the
// backstop timer.
function readSmallFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch {
    return null;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) {
      return null;
    }
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (read === 0) {
        break;
      }
      size += read;
    }
    return size > MAX_FILE_BYTES ? null : buffer.toString('utf8', 0, size);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
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
// null when the section has no `enabled`, or undefined when it can't be
// read with confidence.
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
  if (section === null) {
    return undefined;
  }
  if (section.values.length === 0) {
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
// not plainly to true, or the file mentions both words but has no plain
// top-level `telemetry` key, telemetry is treated as off. YAML tags,
// anchors, aliases and merge keys are never interpreted.
function configDisablesTelemetry(rawText) {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .replace(/^---[ \t]+(?=\S)/, '')
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
// file is skipped, as the CLI's read_telemetry_config does. A non-regular or
// oversized file counts as unreadable.
function telemetryOffByConfig(cwd, home) {
  return configPaths(cwd, home).some((file) => {
    const text = readSmallFile(file);
    return text !== null && configDisablesTelemetry(text);
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
    value = JSON.parse(readSmallFile(instancePath(home)));
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

// ── Agent names ──────────────────────────────────────────────────────────

function readPluginManifest(pluginRoot) {
  try {
    const manifest = JSON.parse(readSmallFile(path.join(pluginRoot, '.claude-plugin', 'plugin.json')));
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
      const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
        timeout: SEND_TIMEOUT_MS,
      };
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

  if (telemetryOffByEnv(env) || telemetryOffByPluginOption(env)) {
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
  const home = homeDir(env);
  if (home === null) {
    return;
  }
  const cwd = nonEmptyString(payload.cwd) || process.cwd();
  if (telemetryOffByConfig(cwd, home)) {
    return;
  }

  const record = ensureInstance(home);
  if (!record.telemetry_consent) {
    return;
  }

  await send(DEFAULT_TELEMETRY_ENDPOINT, buildEventBody({ ...invocation, uuid: record.UUID, version: manifest.version }));
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
  INSTANCE_SCHEMA_VERSION,
  MAX_HOOK_PAYLOAD_BYTES,
  NIL_UUID_SENTINEL,
  SEND_TIMEOUT_MS,
  SOLUTION_ID,
  buildEventBody,
  configDisablesTelemetry,
  ensureInstance,
  konductorAgentName,
  readInstanceRaw,
  resolveInvocation,
};
