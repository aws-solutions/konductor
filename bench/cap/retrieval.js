// SPDX-License-Identifier: Apache-2.0
'use strict';

// An offline copy of the `find_skills` tool of the skills server, so a trigger proxy can show a model the candidates
// the real tool would return without starting a server. Semantics (from the skill-lookup index): `name` is a
// case-insensitive substring of the skill name; `keyword` is a case-insensitive substring of the name or of the
// description, checked per field; `tag` is an exact case-insensitive match on one tag; given filters are ANDed;
// results sort by lower-case name. An agent's --skill-name-filter is a comma list of patterns where `*` matches any run.
// An empty string, a non-string or an unknown argument is an error, as it is on the server.

const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');

const ARGS = ['name', 'keyword', 'tag'];

/** Tags from a frontmatter `tags` value: an inline list, a list that starts on the next lines, or a dash list. */
function tagsOfFrontmatter(fm) {
  const lines = fm.split('\n');
  const i = lines.findIndex((l) => /^tags:/.test(l));
  if (i < 0) return [];
  let text = lines[i].replace(/^tags:/, '');
  for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) text += `\n${lines[j]}`;
  const bracket = /\[([\s\S]*)\]/.exec(text);
  const items = bracket ? bracket[1].split(',') : text.split('\n').filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, ''));
  return items.map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** Every skill under `<root>/skills/*\/SKILL.md` as { name, description, tags, sizeBytes }; the name is the frontmatter name. */
function skillRecords(root) {
  const dir = path.join(root, 'skills');
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return out; }
  for (const e of entries) {
    let text;
    try { text = fs.readFileSync(path.join(dir, e.name, 'SKILL.md'), 'utf8'); } catch { continue; }
    const fm = frontmatter(text);
    const name = fmValue(fm, 'name').trim().replace(/^["']|["']$/g, '') || e.name;
    out.push({ name, description: fmValue(fm, 'description').replace(/^["']|["']$/g, ''), tags: tagsOfFrontmatter(fm), sizeBytes: Buffer.byteLength(text) });
  }
  return out.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

/** `*` matches any run of characters; every other character is literal; case-insensitive. */
function matchGlob(pattern, text) {
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
  return re.test(text);
}

/** Applies an agent's skill name filter (a list of globs, as in --skill-name-filter); null keeps everything. */
function filterRecords(records, patterns) {
  if (!patterns) return records;
  return records.filter((r) => patterns.some((p) => matchGlob(p.trim(), r.name)));
}

/**
 * `args` as the model would pass them to find_skills. Keys that start with two underscores are tool-use notes the
 * client strips. Returns { ok: true, records } or { ok: false, error }.
 */
function findSkills(records, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'arguments must be an object' };
  const given = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith('__')) continue;
    if (!ARGS.includes(k)) return { ok: false, error: `unknown argument "${k}" (find_skills takes ${ARGS.join(', ')})` };
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { ok: false, error: `${k} must be a string` };
    if (v === '') return { ok: false, error: `${k} must not be empty` };
    given[k] = v.toLowerCase();
  }
  const hits = records.filter((r) => {
    const name = r.name.toLowerCase();
    return (given.name === undefined || name.includes(given.name))
      && (given.keyword === undefined || name.includes(given.keyword) || r.description.toLowerCase().includes(given.keyword))
      && (given.tag === undefined || r.tags.some((t) => t.toLowerCase() === given.tag));
  });
  hits.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  return {
    ok: true,
    records: hits.map((r) => ({ name: r.name, description: r.description, tags: r.tags, version: null, size_bytes: r.sizeBytes, provenance: 'managed' })),
  };
}

module.exports = { skillRecords, filterRecords, findSkills, matchGlob, tagsOfFrontmatter, ARGS };
