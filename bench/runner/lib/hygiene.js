// SPDX-License-Identifier: Apache-2.0
'use strict';

// Looks for credential material in run outputs. Reports file names and pattern names, never the matched text.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scrubString } = require('./scrub.js');

const PATTERNS = [
  { name: 'access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'secret key setting', re: /aws_secret_access_key|AWS_SECRET_ACCESS_KEY/i },
  { name: 'session token setting', re: /aws_session_token|AWS_SESSION_TOKEN/i },
];
const MAX_BYTES = 8 * 1024 * 1024;

function* files(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile()) yield p;
  }
}

function readText(file) {
  try {
    if (fs.statSync(file).size > MAX_BYTES) return null;
    return fs.readFileSync(file, 'latin1');
  } catch { return null; }
}

/** `literals` are exact secret values to look for as well. Returns [{file, pattern}]. */
function scanTree(dir, { literals = [] } = {}) {
  const hits = [];
  for (const file of files(dir)) {
    const text = readText(file);
    if (text === null) continue;
    for (const p of PATTERNS) if (p.re.test(text)) hits.push({ file, pattern: p.name });
    if (literals.some((l) => l && text.includes(l))) hits.push({ file, pattern: 'exact secret value' });
  }
  return hits;
}

/**
 * Replaces each literal with <redacted> in every file under dir; with `shapes`, credential-shaped text too (see scrub.js).
 * Returns the number of files rewritten.
 */
function scrubTree(dir, literals, { shapes = false } = {}) {
  const live = literals.filter(Boolean);
  let n = 0;
  for (const file of files(dir)) {
    const text = readText(file);
    if (text === null) continue;
    const next = shapes ? scrubString(text, live) : live.reduce((t, l) => t.split(l).join('<redacted>'), text);
    if (next === text) continue;
    fs.writeFileSync(file, next, 'latin1');
    n++;
  }
  return n;
}

/**
 * The host's home directory and user name as they could appear in a saved file: the home path of the process, its
 * /home, /local/home and /Users forms for the current user. Returned as [RegExp, replacement] pairs.
 */
function hostPathRules(env = process.env, user = os.userInfo().username) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [];
  if (user && user.length > 2) rules.push([new RegExp(`(?:/local)?/(?:home|Users)/${esc(user)}(?![\\w-])`, 'g'), '<host-home>']);
  const homes = new Set([os.homedir(), env.HOME].filter((h) => typeof h === 'string' && h.length > 6 && h !== os.tmpdir()));
  for (const h of [...homes].sort((a, b) => b.length - a.length)) rules.push([new RegExp(`${esc(h)}(?![\\w-])`, 'g'), '<host-home>']);
  return rules;
}

/**
 * Replaces the host's home path in every file under dir with <host-home>. A session saved from a sandboxed run holds the
 * run's scratch paths; this removes the real user's, should one appear. Returns the number of files rewritten.
 */
function redactHostPaths(dir, rules = hostPathRules()) {
  let n = 0;
  for (const file of files(dir)) {
    const text = readText(file);
    if (text === null) continue;
    const next = rules.reduce((t, [re, to]) => t.replace(re, to), text);
    if (next === text) continue;
    fs.writeFileSync(file, next, 'latin1');
    n++;
  }
  return n;
}

module.exports = { scanTree, scrubTree, redactHostPaths, hostPathRules, PATTERNS };
