// SPDX-License-Identifier: Apache-2.0
'use strict';

// Looks for credential material in run outputs. Reports file names and pattern names, never the matched text.

const fs = require('node:fs');
const path = require('node:path');

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

/** Replaces each literal with <redacted> in every file under dir. Returns the number of files rewritten. */
function scrubTree(dir, literals) {
  const live = literals.filter(Boolean);
  let n = 0;
  for (const file of files(dir)) {
    const text = readText(file);
    if (text === null || !live.some((l) => text.includes(l))) continue;
    fs.writeFileSync(file, live.reduce((t, l) => t.split(l).join('<redacted>'), text), 'latin1');
    n++;
  }
  return n;
}

module.exports = { scanTree, scrubTree, PATTERNS };
