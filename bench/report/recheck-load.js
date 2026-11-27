#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free rescore of saved runs' load checks under the fairness rules (runner/lib/load-fairness.js; prompt-fix spec Part B).
//   node bench/report/recheck-load.js --runs DIR --out DIR
// Reads every result.json under --runs (read-only) and writes, under --out at the same relative path, a loadCheck.v2.json:
// the run's own loaded units, scored against the needed units after the rules. A task the rules leave out (needsAgent)
// gets none. --out/summary.json and summary.md hold old and new totals per arm and the units that moved. No model call.
// --out may not be inside --runs. Exit 64 on a usage error.

const fs = require('node:fs');
const path = require('node:path');
const { RULES, fairMustLoad } = require('../runner/lib/load-fairness.js');

/** The v2 load check of one saved result, or null (no load check, or a task the rules leave out). */
function rescoreOne(result) {
  const lc = result.loadCheck;
  if (!lc) return null;
  const need = RULES.needsAgent[result.taskId];
  if (need && result.agent !== need) return null;
  const loaded = new Map((lc.loaded ?? []).map((u) => [u.unit, u]));
  const must = fairMustLoad(result.taskId, (lc.mustLoad ?? []).map((m) => m.unit))
    .map((unit) => { const u = loaded.get(unit); return { unit, loaded: Boolean(u), beforeFirstWrite: u ? Boolean(u.beforeFirstWrite) : false }; });
  return { ...lc, rules: { date: RULES.date, source: RULES.source }, mustLoad: must, mustLoadBeforeWrite: must.length ? must.every((m) => m.beforeFirstWrite) : null };
}

function* results(dir, rel = '') {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) yield* results(dir, r);
    else if (e.name === 'result.json') yield rel;
  }
}

const zero = () => ({ runs: 0, needed: 0, loaded: 0, beforeWrite: 0 });
function add(t, lc) {
  t.runs++;
  for (const m of lc.mustLoad) { t.needed++; if (m.loaded) t.loaded++; if (m.beforeFirstWrite) t.beforeWrite++; }
}

/** Rescores every run under `runs`, writes under `out`, returns the summary. */
function recheck({ runs, out }) {
  const R = path.resolve(runs);
  const O = path.resolve(out);
  if (O === R || O.startsWith(R + path.sep)) throw new Error(`--out ${out} is inside the runs dir; the saved runs are read-only`);
  const arms = {};
  const units = {};
  for (const rel of results(R)) {
    const res = JSON.parse(fs.readFileSync(path.join(R, rel, 'result.json'), 'utf8'));
    if (!res.loadCheck) continue;
    const a = (arms[res.armId] ??= { old: zero(), new: zero() });
    add(a.old, res.loadCheck);
    const v2 = rescoreOne(res);
    for (const [side, l] of [['old', res.loadCheck], ['new', v2]]) {
      for (const m of l?.mustLoad ?? []) {
        const u = ((units[res.armId] ??= {})[m.unit] ??= { old: 0, new: 0 });
        u[side]++;
      }
    }
    if (!v2) continue;
    add(a.new, v2);
    fs.mkdirSync(path.join(O, rel), { recursive: true });
    fs.writeFileSync(path.join(O, rel, 'loadCheck.v2.json'), `${JSON.stringify(v2, null, 2)}\n`);
  }
  const moved = Object.entries(units).flatMap(([arm, us]) => Object.entries(us).filter(([, c]) => c.old !== c.new).map(([unit, c]) => ({ arm, unit, ...c })));
  const summary = { runs: R, rules: RULES, arms, moved };
  fs.mkdirSync(O, { recursive: true });
  fs.writeFileSync(path.join(O, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(O, 'summary.md'), markdown(summary));
  return summary;
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : 'n/a');
function markdown(s) {
  const lines = [`# Load check rescore under the fairness rules (${s.rules.date})`, '', `Runs: ${s.runs} (read-only). Rules: bench/scenarios/load-fairness.json. ${s.rules.why}`, '',
    '| arm | runs old | runs new | needed old | needed new | loaded old | loaded new | before write old | before write new |', '|---|---|---|---|---|---|---|---|---|'];
  for (const [arm, a] of Object.entries(s.arms).sort()) lines.push(`| ${arm} | ${a.old.runs} | ${a.new.runs} | ${a.old.needed} | ${a.new.needed} | ${pct(a.old.loaded, a.old.needed)} | ${pct(a.new.loaded, a.new.needed)} | ${pct(a.old.beforeWrite, a.old.needed)} | ${pct(a.new.beforeWrite, a.new.needed)} |`);
  lines.push('', '| arm | unit | runs needing it, old | new |', '|---|---|---|---|');
  for (const m of s.moved) lines.push(`| ${m.arm} | ${m.unit} | ${m.old} | ${m.new} |`);
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if ((argv[i] === '--runs' || argv[i] === '--out') && argv[i + 1]) opt[argv[i].slice(2)] = argv[i + 1];
    else { console.error('usage: recheck-load.js --runs DIR --out DIR'); return 64; }
  }
  if (!opt.runs || !opt.out) { console.error('usage: recheck-load.js --runs DIR --out DIR'); return 64; }
  const s = recheck(opt);
  process.stdout.write(markdown(s));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { recheck, rescoreOne };
