#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks every relative link in the bench docs: the target file exists, and a #anchor names a heading in it.
// Usage: node bench/scripts/check-doc-links.js   (exit 1 and one line per broken link)

const fs = require('node:fs');
const path = require('node:path');

const BENCH = path.join(__dirname, '..');
// Task fixtures, reference answers and scenario packs are agent inputs, not docs.
const SKIP = /[\\/](scenarios|fixtures|solutions|stubs|partials|hidden|node_modules)[\\/]/;

function docFiles(dir = BENCH, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.test(p + path.sep)) docFiles(p, out); } else if (e.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

// GitHub's heading id: lower case, drop everything but letters, digits, spaces, hyphens and underscores, spaces to hyphens.
function slug(text) {
  return text.replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

// Drops fenced code blocks: a heading or a link inside one is example text.
function stripFences(text) {
  let fence = null;
  return text.split('\n').filter((line) => {
    const m = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.trim().slice(m[1].length).trim()) fence = null; return false; }
    if (m) { fence = m[1]; return false; }
    return true;
  }).join('\n');
}

const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const text = stripFences(fs.readFileSync(file, 'utf8'));
  const seen = new Map();
  const ids = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/\b(?:id|name)="([^"]+)"/g)) ids.add(m[1]);
  anchorCache.set(file, ids);
  return ids;
}

function checkFile(file) {
  const problems = [];
  const text = stripFences(fs.readFileSync(file, 'utf8')).replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\bsrc="([^"]+)"/g)) {
    const target = m[1] || m[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto: and the like
    const [p, anchor] = target.split('#');
    const dest = p ? path.resolve(path.dirname(file), decodeURIComponent(p)) : file;
    const rel = path.relative(BENCH, file);
    if (!fs.existsSync(dest)) { problems.push(`${rel}: ${target}: no such file`); continue; }
    if (anchor && dest.endsWith('.md') && !anchors(dest).has(anchor)) problems.push(`${rel}: ${target}: no heading #${anchor}`);
  }
  return problems;
}

function checkAll(files = docFiles()) {
  return files.flatMap(checkFile);
}

module.exports = { checkAll, checkFile, docFiles, slug };

if (require.main === module) {
  const problems = checkAll();
  for (const p of problems) console.log(p);
  console.log(problems.length ? `${problems.length} broken link(s)` : `ok: ${docFiles().length} files, no broken links`);
  process.exit(problems.length ? 1 : 0);
}
