// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-run AWS credentials for the opencode harness. Only the named profile of a credentials file is
// copied into the run's scratch HOME, and the copy is deleted when the agent exits. Values are never
// logged or returned in error messages.

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = ['aws_access_key_id', 'aws_secret_access_key'];
const SECRET_KEYS = ['aws_secret_access_key', 'aws_session_token'];

function sections(text) {
  const out = new Map();
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const head = /^\[(?:profile\s+)?([^\]\s]+)\]$/.exec(line);
    if (head) { cur = head[1]; if (!out.has(cur)) out.set(cur, []); continue; }
    if (cur && line && !line.startsWith('#') && !line.startsWith(';')) out.get(cur).push(line);
  }
  return out;
}

function parseKeys(lines) {
  const kv = {};
  for (const l of lines) {
    const m = /^([^=\s]+)\s*=\s*(.*)$/.exec(l);
    if (m) kv[m[1].toLowerCase()] = m[2].trim();
  }
  return kv;
}

/** Returns {text, secrets}: a credentials file holding only `profile`, and its secret values (for scrubbing). */
function extractProfile(iniText, profile) {
  const lines = sections(iniText).get(profile);
  if (!lines) throw new Error(`profile "${profile}" not found in the credentials file`);
  const kv = parseKeys(lines);
  const missing = REQUIRED.filter((k) => !kv[k]);
  if (missing.length) throw new Error(`profile "${profile}" lacks ${missing.join(', ')}`);
  const text = `[${profile}]\n${Object.entries(kv).map(([k, v]) => `${k} = ${v}`).join('\n')}\n`;
  return { text, secrets: SECRET_KEYS.map((k) => kv[k]).filter(Boolean).concat(kv.aws_access_key_id) };
}

function readProfile(credsFile, profile) {
  let text;
  try { text = fs.readFileSync(credsFile, 'utf8'); } catch (e) { throw new Error(`cannot read the credentials file: ${e.code || 'error'}`); }
  return extractProfile(text, profile);
}

/** Writes <home>/.aws/credentials (0600) and a config that names the region. Returns the two paths. */
function installCredentials({ credsFile, profile, home, region }) {
  const { text } = readProfile(credsFile, profile);
  const dir = path.join(home, '.aws');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'credentials');
  const configFile = path.join(dir, 'config');
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.writeFileSync(configFile, `[profile ${profile}]\nregion = ${region}\n`, { mode: 0o600 });
  return { file, configFile };
}

function removeCredentials(home) {
  fs.rmSync(path.join(home, '.aws'), { recursive: true, force: true });
}

module.exports = { extractProfile, readProfile, installCredentials, removeCredentials };
