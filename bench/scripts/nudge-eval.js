#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Offline precision and recall of a skill-nudge matcher against the expected skills of the root-cause tasks. Calls no model.
//
//   node bench/scripts/nudge-eval.js --matcher FILE --repo DIR [--manifest FILE] [--json]
//
// --matcher is the skill-nudge.js of the arm under test, --repo the tree its skills and agent specs come from. For each
// (task, entry agent) with expected skills, the matcher sees the task prompt and the skills that agent can load, and its
// picks (at most three) are compared with the manifest. "possible" skills count as neither right nor wrong in the lenient column.

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks, suiteExtraDirs, BENCH_DIR } = require('../runner/lib/tasks.js');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function skillNamesOf(repo, agent) {
  const file = path.join(repo, 'agents', `${agent}.agent-spec.json`);
  if (!fs.existsSync(file)) return null;
  return new Set(readJson(file).dependencies?.skills?.skillNames ?? []);
}

/** One row per (task, entry agent) with expected skills. */
function evaluate({ matcher, repo, manifest, tasks }) {
  const rows = [];
  const skillsDir = path.join(repo, 'skills');
  for (const t of manifest.tasks) {
    const task = tasks.get(t.id);
    if (!task) continue;
    for (const e of t.entries ?? []) {
      const expected = e.expectedSkills ?? [];
      if (!expected.length) continue;
      const allow = skillNamesOf(repo, e.agent);
      const picks = matcher.matchPrompt(task.prompt, matcher.loadSkills([skillsDir], allow)).map((m) => m.name);
      const possible = new Set(e.possibleSkills ?? []);
      const hit = picks.filter((p) => expected.includes(p));
      rows.push({
        task: t.id, agent: e.agent, expected, picks, hits: hit,
        neutral: picks.filter((p) => !expected.includes(p) && possible.has(p)),
        wrong: picks.filter((p) => !expected.includes(p) && !possible.has(p)),
        reachable: expected.filter((s) => allow?.has(s)),
      });
    }
  }
  return rows;
}

const ratio = (n, d) => (d ? n / d : null);
const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

function summarize(rows) {
  const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
  const picks = sum((r) => r.picks.length);
  const hits = sum((r) => r.hits.length);
  const expected = sum((r) => r.expected.length);
  const neutral = sum((r) => r.neutral.length);
  const perSkill = {};
  for (const r of rows) for (const s of r.expected) {
    const c = (perSkill[s] ??= { expected: 0, found: 0, tasks: [] });
    c.expected++;
    if (r.hits.includes(s)) c.found++;
    c.tasks.push(r.task);
  }
  return {
    entries: rows.length, picks, hits, expected,
    precision: ratio(hits, picks), lenientPrecision: ratio(hits + neutral, picks), recall: ratio(hits, expected),
    entriesWithAnyHit: rows.filter((r) => r.hits.length).length, entriesWithNoPick: rows.filter((r) => !r.picks.length).length,
    perSkill,
  };
}

function render(rows, s) {
  const L = [`| task | agent | expected | picked | hit | recall |`, '|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.task} | ${r.agent} | ${r.expected.join(', ')} | ${r.picks.join(', ') || '-'} | ${r.hits.join(', ') || '-'} | ${pct(ratio(r.hits.length, r.expected.length))} |`);
  L.push('', `entries ${s.entries}, picks ${s.picks}, expected ${s.expected}, hits ${s.hits}`);
  L.push(`precision ${pct(s.precision)} (lenient, counting possible skills as right: ${pct(s.lenientPrecision)}), recall ${pct(s.recall)}`);
  L.push(`entries with at least one expected skill picked: ${s.entriesWithAnyHit} of ${s.entries}; entries with no pick: ${s.entriesWithNoPick}`);
  L.push('', '| expected skill | found | of | tasks |', '|---|---|---|---|');
  for (const [name, c] of Object.entries(s.perSkill).sort((a, b) => a[0].localeCompare(b[0]))) L.push(`| ${name} | ${c.found} | ${c.expected} | ${c.tasks.join(', ')} |`);
  return L.join('\n');
}

function main(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  if (!o.matcher || !o.repo) throw new Error('usage: nudge-eval.js --matcher FILE --repo DIR [--manifest FILE] [--json]');
  const manifest = readJson(path.resolve(o.manifest ?? path.join(BENCH_DIR, 'suites', 'rootcause.manifest.json')));
  const tasks = loadTasks(BENCH_DIR, { extraDirs: suiteExtraDirs('rootcause', BENCH_DIR) });
  const rows = evaluate({ matcher: require(path.resolve(o.matcher)), repo: path.resolve(o.repo), manifest, tasks });
  const s = summarize(rows);
  console.log(o.json ? JSON.stringify({ rows, summary: s }, null, 2) : render(rows, s));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}

module.exports = { evaluate, summarize, render, skillNamesOf };
