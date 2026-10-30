// SPDX-License-Identifier: Apache-2.0
'use strict';

// Per-arm run options: `--arm-prefix name=FILE` (text put in front of the task prompt) and `--arm-agent name=AGENT`
// (the agent an arm starts in). Both are recorded in run-config.json; the prefix by hash and size only.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// One argv string is capped near 128 KiB on Linux; the prefix plus the prompt must fit in it.
const MAX_PREFIX_BYTES = 90000;
const AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `a=X,b=Y` -> Map(a -> X, b -> Y). A name may appear once. */
function parsePairs(value, flag) {
  if (value === undefined) return new Map();
  if (value === true || typeof value !== 'string') throw new Error(`--${flag} takes name=VALUE[,name=VALUE]`);
  const out = new Map();
  for (const item of value.split(',').filter(Boolean)) {
    const eq = item.indexOf('=');
    const name = eq > 0 ? item.slice(0, eq) : '';
    const val = eq > 0 ? item.slice(eq + 1) : '';
    if (!name || !val) throw new Error(`--${flag} takes name=VALUE, got "${item}"`);
    if (out.has(name)) throw new Error(`--${flag} names arm "${name}" twice`);
    out.set(name, val);
  }
  return out;
}

function armNamed(arms, name, flag) {
  const a = arms.find((x) => x.id === name);
  if (!a) throw new Error(`--${flag}: arm "${name}" is not among --arms (${arms.map((x) => x.id).join(', ')})`);
  return a;
}

/**
 * Applies both options to the resolved arms in place and returns what run-config records.
 * `arm.prefixText` is the file text, `arm.prefixInfo` its sha256 and size, `arm.agent` the entry agent and
 * `arm.agentOverride` the value that replaced the default.
 */
function applyArmOptions(arms, opts) {
  const armPrefix = {};
  const armAgent = {};
  for (const [name, file] of parsePairs(opts['arm-prefix'], 'arm-prefix')) {
    const arm = armNamed(arms, name, 'arm-prefix');
    let buf;
    try { buf = fs.readFileSync(file); } catch (e) { throw new Error(`--arm-prefix: cannot read ${file}: ${e.code || e.message}`); }
    if (!buf.toString('utf8').trim()) throw new Error(`--arm-prefix: ${file} is empty`);
    if (buf.length > MAX_PREFIX_BYTES) throw new Error(`--arm-prefix: ${file} is ${buf.length} bytes, over the ${MAX_PREFIX_BYTES} byte limit (one argument carries prefix and prompt)`);
    arm.prefixText = buf.toString('utf8');
    arm.prefixInfo = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
    armPrefix[name] = { file, ...arm.prefixInfo };
  }
  for (const [name, agent] of parsePairs(opts['arm-agent'], 'arm-agent')) {
    const arm = armNamed(arms, name, 'arm-agent');
    if (arm.vanilla) throw new Error(`--arm-agent: arm "${name}" is vanilla and vanilla has no agent`);
    if (!AGENT_RE.test(agent)) throw new Error(`--arm-agent: "${agent}" is not a valid agent name`);
    arm.agent = agent;
    arm.agentOverride = agent;
    armAgent[name] = agent;
  }
  return { armPrefix, armAgent };
}

/** The prompt of the first turn: the arm's prefix, a blank line, the task prompt. */
function promptFor(arm, task) {
  return arm?.prefixText ? `${arm.prefixText.replace(/\s+$/, '')}\n\n${task.prompt}` : task.prompt;
}

/** A cap variant arm carries the variant.json that `cap variant` wrote beside its tree; the result records a summary of it. */
function attachVariant(arm) {
  if (arm.source !== 'dir' || !arm.dir) return null;
  let v;
  try { v = JSON.parse(fs.readFileSync(path.join(path.dirname(arm.dir), 'variant.json'), 'utf8')); } catch { return null; }
  if (!v || typeof v.variantId !== 'string') return null;
  arm.variant = { id: v.variantId, baseRef: v.base?.ref ?? null, baseSha: v.base?.commitSha ?? null, tree: v.base?.tree ?? null, variantHash: v.variantHash ?? null, ops: v.ops ?? [] };
  arm.variantFull = v;
  return v;
}

module.exports = { attachVariant, applyArmOptions, promptFor, parsePairs, MAX_PREFIX_BYTES };
