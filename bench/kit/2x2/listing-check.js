#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// listing-check.js REPO COMMIT [--sops on|off|auto] [--budget N] [--builtins N] [--json]
// Free, static estimate of the Claude Code skill listing a konductor install at COMMIT would send, using the rule
// measured on Claude Code 2.1.327 (Sonnet 5.5, 1M window, `claude -p '/context'` in a fresh project; see bench/kit/README.md):
// budget 30,000 chars; built-ins (6,198 chars) always keep their text; every other skill starts name-only, then in name
// order (fresh project, all usage scores 0) a description is added when it still fits; each description is capped at
// 1,536 chars. Skills with `disable-model-invocation: true` are not listed. SOPs are listed only when the Claude install
// at COMMIT does not write that key for them (`--sops auto`). Exit 0 when no konductor skill is name-only, 1 otherwise.
// shortcut: an estimate from the git tree, not the real /context table; the measured install was 58 chars off. Upgrade
// to the per-run numbers bench records (budget, listing chars, described and name-only counts) once that lands.
'use strict';
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const [repo, commit] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!repo || !commit) { console.error('usage: listing-check.js REPO COMMIT [--sops on|off|auto] [--budget N] [--builtins N] [--json]'); process.exit(2); }
const BUDGET = Number(opt('--budget', 30000));
const BUILTINS = Number(opt('--builtins', 6198));
const MAX_DESC = 1536;
const SOP_DESC = 400;
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const show = (p) => git('show', `${commit}:${p}`);

/** name, description and model-invocation flag from a SKILL.md frontmatter (plain, quoted, or > / | block scalars). */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = { name: null, description: '', hidden: false };
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let [, key, val] = kv;
    if (/^[>|][+-]?$/.test(val)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      val = block.filter(Boolean).join(' ');
    } else val = val.replace(/^(["'])([\s\S]*)\1$/, '$2');
    if (key === 'name') out.name = val.trim();
    if (key === 'description') out.description = val.trim();
    if (key === 'disable-model-invocation' && /^true$/i.test(val.trim())) out.hidden = true;
  }
  return out;
}

/** Sentences as claude.rs split_into_sentences cuts them: ends at . ! ? (runs kept) before whitespace or the end. */
function sentences(text) {
  const out = []; let start = 0; let i = 0;
  while (i < text.length) {
    if ('.!?'.includes(text[i])) {
      let end = i + 1;
      while (end < text.length && '.!?'.includes(text[end])) end++;
      if (end >= text.length || /\s/.test(text[end])) { const s = text.slice(start, end).trim(); if (s) out.push(s); start = end; }
      i = end;
    } else i++;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** claude.rs truncate_description: whole sentences up to 400 chars, else the first sentence cut at a word plus "...". */
function truncate(text) {
  if (text.length <= SOP_DESC) return text;
  const ss = sentences(text);
  let res = '';
  for (const s of ss) { if ((res ? res.length + 1 : 0) + s.length > SOP_DESC) break; res = res ? `${res} ${s}` : s; }
  if (res) return res;
  const first = ss[0] || text;
  let cut = SOP_DESC - 3;
  while (cut > 0 && !/\s/.test(first[cut - 1])) cut--;
  if (cut === 0) cut = SOP_DESC - 3;
  return `${first.slice(0, cut).trimEnd().replace(/[,:;]+$/, '')}...`;
}

/** The SOP description as claude.rs renders it: the FIRST paragraph of ## Overview, joined into one line, then
 *  truncate(); with no Overview paragraph, "Standard operating procedure: NAME.". */
function sopDescription(name, body) {
  const lines = body.split(/\r?\n/);
  const i = lines.findIndex((l) => l.trim() === '## Overview');
  const para = [];
  if (i >= 0) {
    for (const l of lines.slice(i + 1)) {
      const t = l.trim();
      if (!t) { if (para.length) break; continue; }
      if (t.startsWith('#')) break;
      para.push(t);
    }
  }
  const text = para.join(' ').replace(/\p{Cc}/gu, '');
  return truncate(text || `Standard operating procedure: ${name}.`);
}

const sopMode = opt('--sops', 'auto');
let sopsListed = sopMode === 'on';
if (sopMode === 'auto') {
  const installer = show('cli/konductor-rs/src/cli/install/claude.rs');
  sopsListed = !/push_str\("disable-model-invocation: true\\n"\)/.test(installer);
}

const files = git('ls-tree', '-r', '--name-only', commit).split('\n');
const entries = [];
for (const f of files.filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p))) {
  const fm = frontmatter(show(f));
  if (fm.hidden) continue;
  entries.push({ name: fm.name || f.split('/')[1], description: fm.description.slice(0, MAX_DESC), kind: 'skill' });
}
if (sopsListed) {
  for (const f of files.filter((p) => /^agent-sops\/[^/]+\.sop\.md$/.test(p))) {
    const sop = f.split('/')[1].replace(/\.sop\.md$/, '');
    entries.push({ name: `sop-${sop}`, description: sopDescription(sop, show(f)), kind: 'sop' });
  }
}
entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const nameOnly = (e) => `- ${e.name}\n`.length;
const full = (e) => (e.description ? `- ${e.name}: ${e.description}\n`.length : nameOnly(e));
let total = BUILTINS + entries.reduce((n, e) => n + nameOnly(e), 0);
const fullTotal = BUILTINS + entries.reduce((n, e) => n + full(e), 0);
const cut = [];
if (fullTotal <= BUDGET) total = fullTotal;
else for (const e of entries) { const extra = full(e) - nameOnly(e); if (total + extra <= BUDGET) total += extra; else cut.push(e); }
const res = {
  commit, budget: BUDGET, builtinsChars: BUILTINS, sopsListed, listed: entries.length, listingChars: fullTotal <= BUDGET ? fullTotal : total,
  fullListingChars: fullTotal, described: entries.length - cut.length, nameOnly: cut.length, nameOnlyNames: cut.map((e) => e.name),
};
if (args.includes('--json')) console.log(JSON.stringify(res));
else console.log(`[2x2] listing at ${commit.slice(0, 10)}: SOPs ${sopsListed ? 'listed' : 'user-only'}, ${res.listed} konductor skills, full listing ${fullTotal} of ${BUDGET} chars (built-ins ${BUILTINS}), ${res.described} described, ${res.nameOnly} name-only${cut.length ? `: ${res.nameOnlyNames.join(', ')}` : ''}`);
process.exit(cut.length ? 1 : 0);
