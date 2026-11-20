#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds bench/scenarios/t2/<id>.json and its fixture, hidden and solution dirs from an author's work dir.
// Usage: node build-task.js <task-id> <work-dir>
//   <work-dir> holds what the author wrote: fixture/ (not for twins), key.json or twin-key.json, solution/, task-draft.json.
// Mapping (map.json) and review (review.json) results in <work-dir> are merged in when present.

const fs = require('node:fs');
const path = require('node:path');
const { reviewChecks, twinChecks } = require('./lib/checks.js');

const DIR = __dirname;
const SLICES = 20;
const FAMILY = { 'gpt-5.6-luna': 'gpt', 'deepseek-3.2': 'deepseek', 'glm-5': 'glm', 'qwen3-coder-next': 'qwen', 'minimax-m2.5': 'minimax' };

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// Python byte-code caches hold the author's host paths; they never belong in a fixture or solution.
const copyDir = (src, dest) => {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (p) => !/(^|[\\/])(__pycache__|\.pytest_cache|\.git)$|\.pyc$/.test(p) });
};

// The directory a code review must leave alone: the top-level dir holding most of the keyed files.
function codeRoot(key) {
  const counts = {};
  for (const it of key.items) { const top = it.file.split('/')[0]; counts[top] = (counts[top] ?? 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

// Public sources an expert-key item may cite (licences checked on each source on 2026-11-19). An item's source is
// written as "Name, URL (licence)" so a reader sees the source by name and address.
const EXPERT_SOURCES = [
  ['https://sre.google/sre-book/table-of-contents/', 'Site Reliability Engineering (Google, O\'Reilly 2016)', 'CC BY-NC-ND 4.0'],
  ['https://cheatsheetseries.owasp.org', 'OWASP Cheat Sheet Series', 'CC BY-SA 4.0'],
  ['https://12factor.net', 'The Twelve-Factor App', 'MIT'],
  ['https://www.rfc-editor.org/rfc/rfc9700', 'RFC 9700, Best Current Practice for OAuth 2.0 Security', 'IETF Trust Legal Provisions'],
  ['https://github.com/kubernetes/enhancements', 'Kubernetes Enhancement Proposals (KEP template)', 'Apache-2.0'],
  ['https://github.com/adr/madr', 'MADR, Markdown Architectural Decision Records', 'MIT OR CC0-1.0'],
];

// Rewrites each item's source to "Name, URL (licence)"; throws on a source outside the list.
function expertKeyOf(raw) {
  const items = raw.items.map((it) => {
    const hit = EXPERT_SOURCES.find(([url]) => String(it.source).includes(url.replace(/\/$/, '')));
    if (!hit) throw new Error(`expert-key item ${it.id}: source not in the checked list: ${it.source}`);
    return { id: it.id, text: it.text, source: `${hit[1]}, ${hit[0]} (${hit[2]})` };
  });
  return { items, weakAnswers: raw.weakAnswers };
}

function build(id, work) {
  const brief = readJson(path.join(DIR, 'briefs', `${id}.json`));
  const draft = readJson(path.join(work, 'task-draft.json'));
  const twin = brief.kind === 'twin';
  const keyFile = twin ? 'twin-key.json' : 'key.json';
  const key = readJson(path.join(work, keyFile));
  const fixture = twin ? brief.twinOf : id;

  if (!twin) copyDir(path.join(work, 'fixture'), path.join(DIR, 'fixtures', id));
  const hidden = path.join(DIR, 'hidden', id, 'hidden');
  fs.rmSync(path.join(DIR, 'hidden', id), { recursive: true, force: true });
  fs.mkdirSync(hidden, { recursive: true });
  for (const f of twin ? ['twin.test.cjs'] : ['findings.test.cjs', 'findings-key.cjs']) fs.copyFileSync(path.join(DIR, 'lib', f), path.join(hidden, f));
  fs.writeFileSync(path.join(hidden, keyFile), `${JSON.stringify(key, null, 2)}\n`);
  copyDir(path.join(work, 'solution'), path.join(DIR, 'solutions', id));

  const testsMin = twin ? key.facts.length + (key.forbidden ?? []).length : SLICES + (key.decoys ?? []).length;
  const checks = twin
    ? twinChecks({ output: key.output, testsMin })
    : reviewChecks({ kind: brief.kind === 'design' ? 'design' : 'code', doc: brief.doc, unchangedPath: brief.kind === 'design' ? brief.doc : codeRoot(key), testsMin });
  const map = fs.existsSync(path.join(work, 'map.json')) ? readJson(path.join(work, 'map.json')) : null;
  const rawReview = fs.existsSync(path.join(work, 'review.json')) ? readJson(path.join(work, 'review.json')) : null;
  const recheckFile = path.join(work, 'recheck.json');
  const recheck = fs.existsSync(recheckFile) ? readJson(recheckFile) : null;
  const review = rawReview && {
    family: FAMILY[brief.reviewer], date: new Date().toISOString().slice(0, 10), verdicts: rawReview.verdicts,
    ...(recheck ? { recheck: { family: FAMILY[recheck.model], model: recheck.model, date: recheck.date, items: recheck.items } } : {}),
  };
  // A task named in HAND-EDITS.md was changed by someone other than its author.
  const handEdited = fs.readFileSync(path.join(DIR, 'HAND-EDITS.md'), 'utf8').includes(`| ${id} |`)
    ? { family: 'claude', editor: 'T2 batch worker session', log: 'HAND-EDITS.md' } : null;
  // The full mapper and reviewer answers and the author's notes are kept beside the task for the human check.
  const rec = path.join(DIR, 'authoring', id);
  fs.mkdirSync(rec, { recursive: true });
  for (const f of ['map.json', 'review.json']) if (fs.existsSync(path.join(work, f))) fs.copyFileSync(path.join(work, f), path.join(rec, f));
  fs.writeFileSync(path.join(rec, 'notes.json'), `${JSON.stringify({ notes: draft.notes }, null, 2)}\n`);
  const source = brief.source.url === 'original' ? 'original' : brief.source;

  const task = {
    id,
    version: 1,
    class: brief.kind === 'design' || (twin && brief.phase === 'design-review') ? 'design' : 'review',
    phase: brief.phase,
    phases2: [],
    role: brief.role,
    prompt: draft.prompt,
    questions: 'allowed',
    fixture,
    hidden: id,
    timeoutSec: draft.limits.hardSec,
    limits: { softSec: draft.limits.softSec, hardSec: draft.limits.hardSec },
    checks,
    rubric: draft.rubric,
    tiers: ['full'],
    ...(twin ? {} : { findingsKey: key.items.map((it) => ({ id: it.id, finding: it.finding, weight: 1 })) }),
    ...(fs.existsSync(path.join(work, 'expert-key.json')) ? { expertKey: expertKeyOf(readJson(path.join(work, 'expert-key.json'))) } : {}),
    targetSkills: map?.targetSkills ?? [],
    targetSop: map?.targetSop ?? null,
    targetAgent: map?.targetAgent ?? null,
    controlKind: twin ? 'twin' : 'none',
    ...(twin ? { twinOf: brief.twinOf } : {}),
    loadCheck: map?.loadCheck ?? { mustLoad: [], mustNotLoad: [] },
    effectSubset: false,
    authorship: { family: FAMILY[brief.author], model: brief.author, date: brief.source.licenceCheckedAt, source },
    ...(review ? { review } : {}),
    ...(handEdited ? { handEdited } : {}),
  };
  fs.writeFileSync(path.join(DIR, `${id}.json`), `${JSON.stringify(task, null, 2)}\n`);
  return task;
}

if (require.main === module) {
  const t = build(process.argv[2], path.resolve(process.argv[3]));
  process.stdout.write(`wrote ${t.id}: ${t.checks.length} checks, fixture ${t.fixture}\n`);
}
module.exports = { build };
