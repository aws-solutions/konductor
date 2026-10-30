// SPDX-License-Identifier: Apache-2.0
'use strict';

// Portable checks on the skills of a tree: naming, description voice, length, links, stray files, reference depth,
// frontmatter keys, a "When to Use" section that repeats the description, and blocks copied between skills. Each
// finding has a stable id (`fid`) so a baseline can waive it. These are our own implementation of the check names.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');
const { descTokens } = require('./text.js');

const NAME_MAX = 64;
const LINES_MAX = 500;
const DUP_WINDOW = 8;
const DUP_MIN_CHARS = 200;
const REDUNDANT_MIN = 0.6;
const KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'version', 'tags', 'source', 'origin', 'last_used']);
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIRST_OR_SECOND = /^\s*(?:i|we|my|our|you|your)\b|\b(?:i|we) (?:can|will|help|am)\b|\byou (?:can|will)\b/i;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const toPosix = (p) => p.split(path.sep).join('/');

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(toPosix(path.relative(dir, p)));
    }
  };
  walk(dir);
  return out.sort();
}

// The local files a markdown text links to, relative to `from` (a path inside the skill directory).
function localLinks(text, from) {
  const out = [];
  for (const m of text.matchAll(LINK)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    out.push({ raw: m[1], path: toPosix(path.normalize(path.join(path.dirname(from), decodeURI(target)))) });
  }
  return out;
}

function sectionOf(body, headingRe) {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => headingRe.test(l));
  if (i < 0) return null;
  const level = /^(#+)/.exec(lines[i])[1].length;
  let j = i + 1;
  while (j < lines.length && !(/^(#+)\s/.test(lines[j]) && /^(#+)/.exec(lines[j])[1].length <= level)) j++;
  return lines.slice(i + 1, j).join('\n');
}

function dupWindows(body) {
  const lines = body.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + DUP_WINDOW <= lines.length; i++) {
    const w = lines.slice(i, i + DUP_WINDOW);
    if (w.join('').length < DUP_MIN_CHARS) continue;
    out.add(crypto.createHash('sha1').update(w.join('\n')).digest('hex'));
  }
  return out;
}

/** Findings for every skill under `<baseDir>/skills`: [{ level: 'warn', id, rule, msg, detail?, fid }]. */
function lintSkills({ baseDir }) {
  const root = path.join(baseDir, 'skills');
  const findings = [];
  if (!fs.existsSync(root)) return findings;
  const add = (id, rule, msg, detail) => findings.push({ level: 'warn', id, rule, msg, ...(detail ? { detail } : {}), fid: `${rule}|${id}${detail ? `|${detail}` : ''}` });
  const windows = new Map();
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const dir of dirs) {
    const skillDir = path.join(root, dir);
    const file = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const id = `skill:${dir}`;
    const text = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    const body = text.slice(text.indexOf('\n---', 4) + 4);
    const name = fmValue(fm, 'name').replace(/^["']|["']$/g, '');
    const desc = fmValue(fm, 'description').replace(/^["']|["']$/g, '');

    if (name && name !== dir) add(id, 'lint-name-dir', `${id}: the name "${name}" differs from its directory "${dir}"`);
    if (!KEBAB.test(name || dir)) add(id, 'lint-name-kebab', `${id}: the name "${name || dir}" is not lower-case kebab-case`);
    if ((name || dir).length > NAME_MAX) add(id, 'lint-name-length', `${id}: the name is ${(name || dir).length} characters, over ${NAME_MAX}`);
    if (desc && FIRST_OR_SECOND.test(desc)) add(id, 'lint-desc-person', `${id}: the description is written in the first or second person; describe the skill in the third person`);
    const lineCount = text.split('\n').length;
    if (lineCount > LINES_MAX) add(id, 'lint-skill-lines', `${id}: SKILL.md has ${lineCount} lines, over ${LINES_MAX}; move detail into reference files`);
    for (const key of fm.split('\n').map((l) => /^([A-Za-z_][\w-]*):/.exec(l)?.[1]).filter(Boolean)) {
      if (!KEYS.has(key)) add(id, 'lint-frontmatter-key', `${id}: frontmatter key "${key}" is not one of ${[...KEYS].join(', ')}`, key);
    }

    const files = listFiles(skillDir).filter((f) => f !== 'SKILL.md');
    const fileSet = new Set(files);
    const direct = localLinks(text, 'SKILL.md');
    for (const l of direct) if (!fileSet.has(l.path) && !fs.existsSync(path.join(skillDir, l.path))) add(id, 'lint-link-broken', `${id}: SKILL.md links to ${l.path}, which does not exist`, l.path);
    const mentioned = (f) => text.includes(f);
    const linkedDirect = new Set(direct.map((l) => l.path).filter((p) => fileSet.has(p)));
    const reached = new Set([...linkedDirect, ...files.filter(mentioned)]);
    // Second level: files that a directly referenced markdown file links to.
    for (const f of [...reached].filter((x) => /\.md$/i.test(x))) {
      const sub = fs.readFileSync(path.join(skillDir, f), 'utf8');
      for (const l of localLinks(sub, f)) {
        if (!fileSet.has(l.path) || l.path === f) continue;
        if (!reached.has(l.path)) add(id, 'lint-ref-depth', `${id}: ${l.path} is linked from ${f}, not from SKILL.md; keep references one level deep`, l.path);
      }
    }
    const deepReached = new Set(findings.filter((f) => f.id === id && f.rule === 'lint-ref-depth').map((f) => f.detail));
    for (const f of files) if (!reached.has(f) && !deepReached.has(f)) add(id, 'lint-orphan-file', `${id}: ${f} is not mentioned in SKILL.md`, f);

    const when = sectionOf(body, /^#{1,6}\s+when to use\b/i);
    if (when !== null && desc) {
      const want = descTokens(desc);
      const have = descTokens(when);
      const kept = [...want].filter((t) => have.has(t)).length;
      if (want.size && kept / want.size >= REDUNDANT_MIN) add(id, 'lint-redundant-when', `${id}: the "When to Use" section repeats the description (${Math.round((kept / want.size) * 100)}% of its words); delete it or add detail the description lacks`);
    }
    for (const h of dupWindows(body)) {
      if (!windows.has(h)) windows.set(h, new Set());
      windows.get(h).add(dir);
    }
  }
  const pairs = new Map();
  for (const owners of windows.values()) {
    const ids = [...owners].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = `${ids[i]}|${ids[j]}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  for (const [key, n] of [...pairs].sort()) {
    const [a, b] = key.split('|');
    add(`skill:${a}`, 'lint-dup-block', `skill:${a} and skill:${b} share ${n} identical ${DUP_WINDOW}-line window(s); one of them should point to the other`, `skill:${b}`);
  }
  return findings;
}

module.exports = { lintSkills, KEYS };
