// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256, readJson, writeJson } = require('./util.js');

const SKILL_RE = /^[a-z0-9][a-z0-9-]*$/;
const rootDir = () => (process.env.SKILLEVAL_ROOT ? path.resolve(process.env.SKILLEVAL_ROOT) : path.resolve(__dirname, '..'));

const skillDir = (skill, root = rootDir()) => {
  if (!SKILL_RE.test(skill ?? '')) throw new Error(`--skill must be a skill name such as test-coverage-analysis (got "${skill}")`);
  return path.join(root, skill);
};

function frontmatterOf(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^([a-z_-]+):\s*(.*)$/i); if (kv) out[kv[1]] = kv[2].trim(); }
  return out;
}

/**
 * The skill text this evaluation is built on. The first call reads it from --skill-file or from `git show REF:skills/NAME/SKILL.md`
 * in --repo and keeps a copy under the skill directory; later calls read that copy so the quotes always check against the same bytes.
 */
function loadSkill({ skill, ref, file, repo = process.cwd(), root = rootDir() }) {
  const dir = skillDir(skill, root);
  const copy = path.join(dir, 'source', 'SKILL.md');
  const meta = path.join(dir, 'source', 'source.json');
  let text;
  if (file || ref) {
    text = file
      ? fs.readFileSync(path.resolve(file), 'utf8')
      : execFileSync('git', ['-C', repo, 'show', `${ref}:skills/${skill}/SKILL.md`], { encoding: 'utf8', maxBuffer: 1 << 25 });
    const digest = sha256(text);
    if (fs.existsSync(copy) && sha256(fs.readFileSync(copy, 'utf8')) !== digest) {
      throw new Error(`${skill}: a different SKILL.md is already stored under ${path.relative(process.cwd(), copy)}; remove the skill directory to start over`);
    }
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.writeFileSync(copy, text);
    writeJson(meta, { skill, ref: ref ?? null, sha256: digest, lines: text.split('\n').length });
  } else if (fs.existsSync(copy)) {
    text = fs.readFileSync(copy, 'utf8');
  } else {
    throw new Error(`${skill}: no stored SKILL.md; pass --ref GITREF (with --repo DIR) or --skill-file FILE on the first command`);
  }
  const fm = frontmatterOf(text);
  const sourceMeta = fs.existsSync(meta) ? readJson(meta) : { skill, ref: ref ?? null, sha256: sha256(text) };
  return { skill, dir, text, description: fm.description ?? '', source: { ref: sourceMeta.ref, sha256: sourceMeta.sha256 } };
}

const PLAIN_PHRASE = /^[A-Za-z][A-Za-z0-9&/-]*(?: [A-Za-z0-9&/-]+){1,5}$/;

/**
 * Terms a request must not contain because they come from the skill itself: its exact name, headings and bold or code spans of
 * two to six plain words, hyphenated or underscored identifiers, and acronyms. A single ordinary word is allowed, as are the words
 * of the name and the one-line description, which a user would use anyway.
 */
function buildStoplist({ skill, text, description = '' }) {
  const terms = new Set();
  const add = (t) => { const v = String(t).toLowerCase().replace(/\s+/g, ' ').trim(); if (v.length >= 3) terms.add(v); };
  const nameTokens = skill.split('-');
  add(skill);
  add(nameTokens.join(' '));
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  const domain = new Set([...nameTokens, ...(description.toLowerCase().match(/[a-z][a-z0-9-]+/g) ?? [])]);
  const phrase = (raw) => {
    const p = String(raw).replace(/[`*_]/g, '').trim().replace(/[:.]$/, '');
    if (PLAIN_PHRASE.test(p)) add(p);
    else if (/^[A-Za-z][A-Za-z0-9]*[-_][A-Za-z0-9_-]+$/.test(p) && p.length >= 4) add(p);
  };
  for (const m of body.matchAll(/^#{1,4}\s+(.+)$/gm)) phrase(m[1]);
  for (const m of body.matchAll(/\*\*([^*\n]+)\*\*|`([^`\n]+)`/g)) phrase(m[1] ?? m[2]);
  for (const m of body.matchAll(/\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z][A-Z0-9]{1,5}\b/g)) add(m[0]);
  for (const t of [...terms]) {
    const words = t.match(/[a-z0-9]+/g) ?? [];
    if (t !== skill && t !== nameTokens.join(' ') && words.every((w) => domain.has(w) || domain.has(w.replace(/s$/, '')))) terms.delete(t);
  }
  return [...terms].sort();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The stoplist terms found in `text`, matched case-insensitively on word boundaries. */
function stoplistHits(text, stoplist) {
  const t = String(text);
  return stoplist.filter((term) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(term).replace(/ /g, '[\\s-]+')}(?![A-Za-z0-9])`, 'i').test(t));
}

module.exports = { loadSkill, skillDir, frontmatterOf, buildStoplist, stoplistHits, rootDir, SKILL_RE };
