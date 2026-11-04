#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers for pilot-2x2.sh: the marker file that makes an output directory resumable, the state of a finished
// run or judged directory, and spend. It reads result files only and never needs credentials.

const fs = require('node:fs');
const path = require('node:path');

const CELLS = ['kiro-vanilla', 'kiro-konductor', 'cc-vanilla', 'cc-konductor'];
const MARKER = 'pilot-2x2.json';

const out = (line) => process.stdout.write(`${line}\n`);
const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const fin = (v) => typeof v === 'number' && Number.isFinite(v);

function* resultFiles(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* resultFiles(p);
    else if (e.name === 'result.json') yield p;
  }
}

function summaryFiles(root) {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (fs.existsSync(path.join(p, 'summary.json'))) found.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

// A directory under cells/ that sits inside another pilot output, or an output that holds one, is refused.
function initOut(args) {
  const dir = path.resolve(args[0]);
  const want = { tasks: flag(args, '--tasks'), reps: flag(args, '--reps'), seed: flag(args, '--seed'), ref: flag(args, '--ref'), kiroModel: flag(args, '--kiro-model'), ccModel: flag(args, '--cc-model') };
  const dry = args.includes('--dry-run');
  for (let up = path.dirname(dir); up !== path.dirname(up); up = path.dirname(up)) {
    if (fs.existsSync(path.join(up, MARKER))) { out(`FAIL ${dir} is inside the pilot output ${up}; pick a directory of its own`); process.exit(1); }
  }
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) { out(`FAIL ${dir} exists and is not a directory`); process.exit(1); }
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (entries.length === 0) {
    if (!dry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, MARKER), `${JSON.stringify({ tool: 'pilot-2x2', schemaVersion: 1, createdAt: new Date().toISOString(), ...want }, null, 2)}\n`);
    }
    out('fresh');
    return;
  }
  const marker = readJson(path.join(dir, MARKER));
  if (!marker || marker.tool !== 'pilot-2x2') { out(`FAIL ${dir} is not empty and is not the output of an earlier pilot-2x2 run; pass a new or empty directory`); process.exit(1); }
  const diff = Object.keys(want).filter((k) => want[k] !== undefined && String(marker[k]) !== String(want[k]));
  if (diff.length) { out(`FAIL ${dir} was started with different settings (${diff.map((k) => `${k}: ${marker[k]} then, ${want[k]} now`).join('; ')}); a resume must repeat them`); process.exit(1); }
  out('resume');
}

// complete | missing | partial | interrupted | infra-error | budget-skipped | unfinished
function cellState(args) {
  const dir = args[0];
  const reps = Number(args[1]);
  if (!fs.existsSync(dir)) { out('missing'); return; }
  const s = readJson(path.join(dir, 'summary.json'));
  if (!s) { out('unfinished'); return; }
  if (s.interrupted) { out('interrupted'); return; }
  if (!s.isolationGate || s.isolationGate.ok !== true) { out('unfinished'); return; }
  const results = Array.isArray(s.results) ? s.results : [];
  if (results.length !== reps || [...resultFiles(dir)].length !== reps) { out('partial'); return; }
  if (results.some((r) => r.status === 'budget_skipped')) { out('budget-skipped'); return; }
  if (results.some((r) => r.infraError)) { out('infra-error'); return; }
  out('complete');
}

// Spend so far: USD of the Claude Code cells and credits of the Kiro cells, from every summary under cells/ and incomplete/.
function spendOf(rootDir) {
  const root = path.resolve(rootDir);
  const total = { credits: 0, usd: 0, judgeUsd: 0, byCell: {} };
  for (const c of CELLS) total.byCell[c] = { runs: 0, credits: 0, usd: 0, judgeUsd: 0, unmetered: 0 };
  for (const sub of ['cells', 'incomplete']) {
    for (const dir of summaryFiles(path.join(root, sub))) {
      const rel = path.relative(path.join(root, sub), dir).split(path.sep);
      const cell = sub === 'cells' ? rel[0] : (CELLS.find((c) => rel[0].startsWith(`${c}-`)) ?? null);
      const row = cell && total.byCell[cell];
      if (!row) continue;
      const s = readJson(path.join(dir, 'summary.json'));
      const results = Array.isArray(s?.results) ? s.results : [];
      row.runs += results.length;
      if (cell.startsWith('cc-')) {
        const v = fin(s?.totalCostUsdCharged) ? s.totalCostUsdCharged : results.reduce((n, r) => n + (fin(r.costUsdCharged) ? r.costUsdCharged : fin(r.costUsd) ? r.costUsd : 0), 0);
        row.usd += v;
      } else {
        row.credits += fin(s?.totalCreditsCharged) ? s.totalCreditsCharged : results.reduce((n, r) => n + (fin(r.creditsCharged) ? r.creditsCharged : fin(r.credits) ? r.credits : 0), 0);
      }
      row.unmetered += results.filter((r) => r.costCensored || r.creditsCensored).length;
      const j = readJson(path.join(dir, 'judgments.json'));
      if (fin(j?.spentUsd)) row.judgeUsd += j.spentUsd;
    }
  }
  for (const r of Object.values(total.byCell)) { total.credits += r.credits; total.usd += r.usd; total.judgeUsd += r.judgeUsd; }
  return total;
}

function spend(args) {
  const total = spendOf(args[0]);
  if (args.includes('--json')) { out(JSON.stringify(total)); return; }
  out(`cc_usd=${total.usd.toFixed(4)} judge_usd=${total.judgeUsd.toFixed(4)} kiro_credits=${total.credits.toFixed(3)}`);
}

// full | partial N/M | none : rubric records of every panel judge for every scored run of a directory.
function judged(args) {
  const dir = args[0];
  const panel = (flag(args, '--judges') ?? '').split(',').filter(Boolean);
  const j = readJson(path.join(dir, 'judgments.json'));
  if (!j) { out('none'); return; }
  const runs = [...resultFiles(dir)].map((f) => readJson(f)).filter((r) => r && r.status !== 'budget_skipped' && !r.infraError);
  let have = 0;
  const need = runs.length * panel.length;
  for (const r of runs) {
    for (const judge of panel) {
      if ((j.rubric ?? []).some((x) => x.judge === judge && x.armId === r.armId && x.taskId === r.taskId && x.replicate === r.replicate && fin(x.score))) have++;
    }
  }
  out(need && have === need ? 'full' : `partial ${have}/${need}`);
}

// Per-cell table of what was spent, from the result files: runs, finished, timeouts and the cost in the cell's own unit.
function summary(args) {
  const root = path.resolve(args[0]);
  const sp = spendOf(root);
  out('| cell | runs | cost | judge USD |');
  out('|---|---|---|---|');
  for (const c of CELLS) {
    const r = sp.byCell[c];
    const cost = c.startsWith('cc-') ? `USD ${r.usd.toFixed(3)}` : `${r.credits.toFixed(2)} credits`;
    out(`| ${c} | ${r.runs} | ${cost}${r.unmetered ? ` (${r.unmetered} run(s) not metered)` : ''} | ${r.judgeUsd.toFixed(3)} |`);
  }
  out(`Claude Code runs: USD ${sp.usd.toFixed(3)}; judging: USD ${sp.judgeUsd.toFixed(3)}; total USD ${(sp.usd + sp.judgeUsd).toFixed(3)}. Kiro runs: ${sp.credits.toFixed(2)} credits.`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'init-out') initOut(args);
  else if (cmd === 'cell-state') cellState(args);
  else if (cmd === 'spend') spend(args);
  else if (cmd === 'judged') judged(args);
  else if (cmd === 'summary') summary(args);
  else { process.stderr.write('usage: pilot-2x2.js init-out|cell-state|spend|judged|summary\n'); process.exit(2); }
} catch (e) {
  out(`FAIL ${cmd}: ${String(e.message).split('\n')[0]}`);
  process.exit(1);
}
