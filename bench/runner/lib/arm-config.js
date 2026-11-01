// SPDX-License-Identifier: Apache-2.0
'use strict';

// `--arm-config name=key.path=value[;key.path=value]`: keys for one arm's ~/.konductor/config.yml. The file is written
// into the run's scratch HOME after the install, so the arm starts its session with them. The konductor CLI reads
// `orchestration.mode` (auto or coordinator) from this user file only.

const fs = require('node:fs');
const path = require('node:path');
const { parsePairs } = require('./arm-opts.js');

const KEY_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const ORCHESTRATION_MODES = ['auto', 'coordinator'];
const ORCHESTRATION_KEYS = ['mode'];

function typed(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function setPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  parts.slice(0, -1).forEach((p, i) => {
    if (cur[p] === undefined) cur[p] = {};
    if (typeof cur[p] !== 'object' || cur[p] === null) throw new Error(`--arm-config: "${keyPath}" conflicts with "${parts.slice(0, i + 1).join('.')}", which is already a value`);
    cur = cur[p];
  });
  const leaf = parts.at(-1);
  if (leaf in cur) throw new Error(`--arm-config: "${keyPath}" is given ${typeof cur[leaf] === 'object' ? 'both as a value and as a section, which conflicts' : 'twice'}`);
  cur[leaf] = value;
}

// A misspelled orchestration key falls back to auto without an error, which would turn a coordinator arm into a second auto arm.
function checkKnown(keyPath, raw) {
  const [head, key] = keyPath.split('.');
  if (head !== 'orchestration') return;
  if (!key || !ORCHESTRATION_KEYS.includes(key)) throw new Error(`--arm-config: unknown orchestration key "${key ?? ''}" (known: ${ORCHESTRATION_KEYS.join(', ')})`);
  if (keyPath === 'orchestration.mode' && !ORCHESTRATION_MODES.includes(raw)) throw new Error(`--arm-config: orchestration.mode must be ${ORCHESTRATION_MODES.join(' or ')}, got "${raw}"`);
}

/** `a=k.p=v;k2=v2,b=...` -> Map(arm -> nested object). */
function parseArmConfig(value) {
  const out = new Map();
  for (const [arm, spec] of parsePairs(value, 'arm-config')) {
    const obj = {};
    for (const item of spec.split(';').filter(Boolean)) {
      const eq = item.indexOf('=');
      const key = eq > 0 ? item.slice(0, eq) : '';
      const raw = eq > 0 ? item.slice(eq + 1) : '';
      if (!key || !raw) throw new Error(`--arm-config takes name=key.path=value, got "${arm}=${item}"`);
      if (!KEY_RE.test(key)) throw new Error(`--arm-config: "${key}" is not a valid key path (letters, digits, - and _ joined by dots)`);
      checkKnown(key, raw);
      setPath(obj, key, typed(raw));
    }
    out.set(arm, obj);
  }
  return out;
}

const YAML_WORDS = /^(true|false|yes|no|on|off|null|~)$/i;

function scalar(v) {
  if (typeof v !== 'string') return String(v);
  const risky = v === '' || YAML_WORDS.test(v) || /^[-+]?[\d.]+$/.test(v) || /(^\s|\s$|: |#|^[-?:,[\]{}&*!|>'"%@`])/.test(v);
  return risky ? JSON.stringify(v) : v;
}

function renderYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  return Object.entries(obj).map(([k, v]) => (v !== null && typeof v === 'object' ? `${pad}${k}:\n${renderYaml(v, indent + 2)}` : `${pad}${k}: ${scalar(v)}\n`)).join('');
}

/** Writes <home>/.konductor/config.yml. An existing file is an error: the install is expected not to create one. */
function writeArmConfig(home, config) {
  const file = path.join(home, '.konductor', 'config.yml');
  if (fs.existsSync(file)) throw new Error(`${file} already exists after the install; the arm config would overwrite it`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderYaml(config));
  return file;
}

module.exports = { parseArmConfig, renderYaml, writeArmConfig, ORCHESTRATION_MODES };
