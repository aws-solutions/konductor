#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Turns the committed skill eval data (bench/skill-evals) into bench tasks and trigger queries.
//   node bench/skilleval/import.js tasks   --skill NAME[,NAME]|all --ref REF --out DIR [--include-limited] [--suites-dir DIR] [--timeout-sec N]
//   node bench/skilleval/import.js queries --skill NAME --out FILE
//   node bench/skilleval/import.js report  --ref REF [--skill NAME[,NAME]] [--include-limited]
// The skills are read from REF; the eval data from the working tree (--evals-dir). Nothing runs a model or the runner.

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib/import.js');

const VALUE_FLAGS = ['skill', 'ref', 'out', 'suites-dir', 'evals-dir', 'repo', 'timeout-sec'];
const BOOL_FLAGS = ['include-limited'];
const COMMANDS = ['tasks', 'queries', 'report'];

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!COMMANDS.includes(cmd)) throw new Error(`usage: import.js ${COMMANDS.join('|')} [options] (see the header of this file)`);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const name = a.slice(2);
    if (BOOL_FLAGS.includes(name)) { opts[name] = true; continue; }
    if (!VALUE_FLAGS.includes(name)) throw new Error(`unknown flag ${a}`);
    if (rest[i + 1] === undefined || rest[i + 1].startsWith('--')) throw new Error(`${a} needs a value`);
    opts[name] = rest[++i];
  }
  return { cmd, opts };
}

function timeoutOpt(opts) {
  if (opts['timeout-sec'] === undefined) return undefined;
  const n = Number(opts['timeout-sec']);
  if (!/^\d+$/.test(opts['timeout-sec']) || n < 1) throw new Error('--timeout-sec must be a positive integer');
  return n;
}

const need = (opts, name) => { if (!opts[name]) throw new Error(`--${name} is required`); return opts[name]; };

function skillNames(opts, evalsDir) {
  const raw = need(opts, 'skill');
  const all = lib.listSkills(evalsDir);
  const names = raw === 'all' ? all : raw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) throw new Error(`bad skill name "${n}"`);
  return names;
}

function cmdTasks(opts, log, g) {
  const evalsDir = path.resolve(opts['evals-dir'] ?? lib.EVALS_DIR);
  const repo = path.resolve(opts.repo ?? lib.REPO);
  const ref = need(opts, 'ref');
  const outDir = path.resolve(need(opts, 'out'));
  const present = g.skillsAtRef(ref, repo);
  const resolved = g.resolveRef(ref, repo);
  const timeoutSec = timeoutOpt(opts);
  const results = [];
  for (const skill of skillNames(opts, evalsDir)) {
    if (!present.has(skill)) { log(`${skill}: skipped: not in ${ref}`); results.push({ skill, skippedAbsent: true }); continue; }
    const plan = lib.planSkill({ skill, evalsDir, includeLimited: Boolean(opts['include-limited']), timeoutSec });
    if (!plan) { log(`${skill}: skipped: no eval data`); results.push({ skill, skippedAbsent: true }); continue; }
    const w = lib.writeSkill(plan, {
      outDir, ref, resolved, blob: g.skillBlob(ref, skill, repo), suitesDir: opts['suites-dir'] ? path.resolve(opts['suites-dir']) : undefined,
    });
    const extra = [plan.held.length ? `${plan.held.length} limited held back` : '', plan.skipped.length ? `${plan.skipped.length} skipped` : ''].filter(Boolean).join(', ');
    log(`${skill}: wrote ${w.ids.length} tasks to ${w.tasksDir}${extra ? ` (${extra})` : ''}`);
    for (const s of plan.skipped) log(`  skipped ${s.id}: ${s.reason}`);
    results.push({ skill, plan, ...w });
  }
  return results;
}

function cmdQueries(opts, log) {
  const evalsDir = path.resolve(opts['evals-dir'] ?? lib.EVALS_DIR);
  const names = skillNames(opts, evalsDir);
  if (names.length !== 1) throw new Error('queries takes exactly one --skill');
  const data = lib.loadSkillData(names[0], evalsDir);
  if (!data) throw new Error(`no eval data for ${names[0]}`);
  const r = lib.filterQueries(names[0], data.queries);
  const out = path.resolve(need(opts, 'out'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(r.kept, null, 2)}\n`);
  log(`${names[0]}: wrote ${r.kept.length} of ${data.queries.length} queries to ${out}; dropped ${r.dropped.length}`);
  for (const d of r.dropped) log(`  dropped #${d.index}: ${d.reason}: ${d.query}`);
  for (const w of r.warnings) log(`  warning: ${w}`);
  log(`  next: node bench/runner/bench.js cap import --cap skill:${names[0]} --from ${out}`);
  return r;
}

function report(opts, g) {
  const evalsDir = path.resolve(opts['evals-dir'] ?? lib.EVALS_DIR);
  const repo = path.resolve(opts.repo ?? lib.REPO);
  const ref = need(opts, 'ref');
  const present = g.skillsAtRef(ref, repo);
  const names = opts.skill ? skillNames(opts, evalsDir) : lib.listSkills(evalsDir);
  const rows = names.map((skill) => {
    const plan = lib.planSkill({ skill, evalsDir, includeLimited: Boolean(opts['include-limited']) });
    const reasons = [];
    if (!present.has(skill)) reasons.push(`not in ${ref}`);
    if (plan?.held.length) reasons.push(`${plan.held.length} limited held back`);
    const counts = new Map();
    for (const s of plan?.skipped ?? []) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
    for (const [why, n] of counts) reasons.push(`${n} skipped: ${why}`);
    return { skill, plan, inRef: present.has(skill), reasons };
  });
  return rows;
}

function cmdReport(opts, log, g) {
  const rows = report(opts, g);
  const head = ['skill', 'scen', 'evals', 'folded', 'eval-only', 'tasks', 'limited', 'skipped', 'in ref', 'notes'];
  const lines = rows.map((r) => {
    const c = r.plan?.counts;
    return [r.skill, c?.scenarios ?? 0, c?.evals ?? 0, c?.folded ?? 0, c?.evalOnly ?? 0, r.inRef ? r.plan?.tasks.length ?? 0 : 0, r.plan?.held.length ?? 0, r.plan?.skipped.length ?? 0, r.inRef ? 'yes' : 'no', r.reasons.join('; ')];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  log(fmt(head));
  for (const l of lines) log(fmt(l));
  const sum = (i) => lines.reduce((n, l) => n + (typeof l[i] === 'number' ? l[i] : 0), 0);
  log(fmt(['total', sum(1), sum(2), sum(3), sum(4), sum(5), sum(6), sum(7), '', '']));
  return rows;
}

// `deps` replaces the three git lookups (skillsAtRef, resolveRef, skillBlob); tests pass stubs.
function main(argv, log = (s) => console.log(s), deps = {}) {
  const { cmd, opts } = parseArgs(argv);
  const g = { skillsAtRef: lib.skillsAtRef, resolveRef: lib.resolveRef, skillBlob: lib.skillBlob, ...deps };
  if (cmd === 'tasks') return cmdTasks(opts, log, g);
  if (cmd === 'queries') return cmdQueries(opts, log);
  return cmdReport(opts, log, g);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`import: ${e.message}`); process.exit(1); }
}

module.exports = { main, parseArgs };
