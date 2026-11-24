#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Cross-run summary of an --introspect out dir. Reads <run>/introspect/timeline.json of every run below the out dir
// (writing it first from the run files when it is missing, for example after a report change) and writes
// <out>/introspect-summary.md and .json: one row per run, then the mean per arm. Reads files only; calls no model.
//
//   node bench/scripts/introspect-summary.js <out-dir> [--rebuild]

const fs = require('node:fs');
const path = require('node:path');
const { writeReport } = require('../runner/lib/introspect/report.js');
const { OTLP, probeOf } = require('../runner/lib/introspect/index.js');

function findRuns(root) {
  const out = [];
  const walk = (d, depth) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    if (names.includes('result.json') && names.includes('introspect')) { out.push(d); return; }
    if (depth > 6) return;
    for (const n of names.sort()) {
      if (n === 'introspect' || n === 'workspace' || n === 'session') continue;
      const p = path.join(d, n);
      try { if (fs.lstatSync(p).isDirectory()) walk(p, depth + 1); } catch { /* skip */ }
    }
  };
  walk(root, 0);
  return out;
}

function rowOf(runDir, root, rebuild) {
  const file = path.join(runDir, 'introspect', 'timeline.json');
  let r;
  if (rebuild || !fs.existsSync(file)) { const { trace, ...rest } = writeReport(runDir); r = rest; } else r = JSON.parse(fs.readFileSync(file, 'utf8'));
  return rowFromReport(r, { run: path.relative(root, runDir), timeline: path.relative(root, path.join(runDir, 'introspect', 'timeline.md')) });
}

/** One summary row from report data. `run` and `timeline` are the paths the row shows, relative to the summary. */
function rowFromReport(r, { run, timeline }) {
  const sum = (k) => (r.requests.some((q) => q[k] != null) ? r.requests.reduce((s, q) => s + (q[k] ?? 0), 0) : null);
  const w = r.probe?.collectorWatch;
  const t = r.skills.totals ?? null;
  const pre = (r.subagents || []).filter((c) => c.preloads?.expected);
  return {
    run, arm: r.run.arm, task: r.run.task, rep: r.run.replicate, harness: r.run.harness,
    status: r.outcome.status, wallS: r.outcome.wallClockMs != null ? r.outcome.wallClockMs / 1000 : null, costUsd: r.outcome.costUsd, credits: r.outcome.credits,
    checks: r.outcome.checks != null ? `${r.outcome.checksPassed}/${r.outcome.checks}` : null,
    requests: r.requests.length, modelMs: sum('latencyMs'), input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'),
    firstRequestTokens: r.first ? Math.round(r.first.totalChars / 4) : null,
    skillsListed: r.first?.skillsListed?.length ?? null, skillsLoaded: r.skills.loaded.length, skillLoadsFailed: r.skills.failed.length, referenceReads: r.skills.referenceReads.length,
    loadedNames: r.skills.loaded,
    hooks: r.hooks.length, hookInstructions: r.first?.hookInstructions?.length ?? null, delegations: r.subagents.length,
    collectorClean: w ? (w.available ? Boolean(w.clean) : null) : null,
    rootLoads: t?.rootLoads ?? null, childLoads: t?.childLoads ?? null, refused: t?.refused ?? null, failedCalls: t?.failed ?? null,
    childRefusedOrFailed: t?.childRefusedOrFailed ?? null,
    // Claude Code only (the OTLP probe): one per (child, frontmatter skill), and the bytes of those skill files.
    preloads: probeOf(r.run.harness) === OTLP ? pre.reduce((n, c) => n + c.preloads.expected.length, 0) : null,
    preloadBytes: probeOf(r.run.harness) === OTLP ? pre.reduce((n, c) => n + c.preloads.expected.reduce((m, x) => m + (x.bytes ?? 0), 0), 0) : null,
    childrenLinked: (r.subagents || []).filter((c) => c.transcript).length,
    timeline,
  };
}

const mean = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const f = (x, d = 1) => (x == null ? 'n/a' : typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : String(x));

function render(rows) {
  const L = ['# Introspection summary', ''];
  L.push(`${rows.length} run(s). Collector watch: ${rows.filter((r) => r.collectorClean === true).length} clean, ${rows.filter((r) => r.collectorClean === false).length} with a connection from the run, ${rows.filter((r) => r.collectorClean == null).length} not checked.`);
  L.push('');
  L.push('| run | status | wall s | cost / credits | checks | requests | model s | in | out | cache r | cache w | first req tok | listed | loaded | failed | refs | hooks | deleg | timeline |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    L.push(`| ${r.arm}/${r.task}/${r.rep} | ${r.status} | ${f(r.wallS)} | ${r.costUsd != null ? `$${r.costUsd.toFixed(3)}` : f(r.credits, 3)} | ${r.checks ?? 'n/a'} | ${r.requests} | ${f(r.modelMs != null ? r.modelMs / 1000 : null)} | ${f(r.input)} | ${f(r.output)} | ${f(r.cacheRead)} | ${f(r.cacheWrite)} | ${f(r.firstRequestTokens)} | ${f(r.skillsListed)} | ${r.skillsLoaded} | ${r.skillLoadsFailed} | ${r.referenceReads} | ${r.hooks} | ${r.delegations} | [md](${r.timeline}) |`);
  }
  L.push('');
  L.push('## Mean per arm and task');
  L.push('');
  L.push('| arm | task | runs | wall s | cost / credits | requests | model s | first req tok | listed | loaded | skills loaded (any run) |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const groups = new Map();
  for (const r of rows) { const k = `${r.arm}\u0000${r.task}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const g of groups.values()) {
    const cost = mean(g.map((r) => r.costUsd));
    L.push(`| ${g[0].arm} | ${g[0].task} | ${g.length} | ${f(mean(g.map((r) => r.wallS)))} | ${cost != null ? `$${cost.toFixed(3)}` : f(mean(g.map((r) => r.credits)), 3)} | ${f(mean(g.map((r) => r.requests)))} | ${f(mean(g.map((r) => (r.modelMs != null ? r.modelMs / 1000 : null))))} | ${f(mean(g.map((r) => r.firstRequestTokens)), 0)} | ${f(mean(g.map((r) => r.skillsListed)), 0)} | ${f(mean(g.map((r) => r.skillsLoaded)))} | ${[...new Set(g.flatMap((r) => r.loadedNames))].join(', ') || 'none'} |`);
  }
  L.push('');
  L.push('## Skill use by scope, per arm');
  L.push('');
  L.push('Counts summed over the arm\'s runs. A preload is one frontmatter skill in one Claude Code sub-agent spawn; kiro-cli has no preload record. Refused is a skill call the engine refused (deferred tool); failed is any other failed skill call.');
  L.push('');
  L.push('| arm | runs | root loads | child loads | preloads | preload bytes | refused | failed | child refused/failed | refs | delegations | linked |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const arms = new Map();
  for (const r of rows) { if (!arms.has(r.arm)) arms.set(r.arm, []); arms.get(r.arm).push(r); }
  const tot = (g, k) => (g.some((r) => typeof r[k] === 'number') ? g.reduce((n, r) => n + (r[k] ?? 0), 0) : null);
  for (const [arm, g] of arms) {
    L.push(`| ${arm} | ${g.length} | ${f(tot(g, 'rootLoads'))} | ${f(tot(g, 'childLoads'))} | ${f(tot(g, 'preloads'))} | ${f(tot(g, 'preloadBytes'))} | ${f(tot(g, 'refused'))} | ${f(tot(g, 'failedCalls'))} | ${f(tot(g, 'childRefusedOrFailed'))} | ${f(tot(g, 'referenceReads'))} | ${f(tot(g, 'delegations'))} | ${f(tot(g, 'childrenLinked'))} |`);
  }
  return `${L.join('\n')}\n`;
}

function main(argv) {
  const args = argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  if (!root) { console.error('usage: introspect-summary.js <out-dir> [--rebuild]'); process.exit(2); }
  const rows = findRuns(path.resolve(root)).map((d) => rowOf(d, path.resolve(root), args.includes('--rebuild')));
  const md = path.join(root, 'introspect-summary.md');
  fs.writeFileSync(md, render(rows), { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'introspect-summary.json'), `${JSON.stringify(rows, null, 2)}\n`, { mode: 0o600 });
  console.log(`${rows.length} run(s) -> ${md}`);
}

if (require.main === module) main(process.argv);

module.exports = { findRuns, rowOf, rowFromReport, render };
