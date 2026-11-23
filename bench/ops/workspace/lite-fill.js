#!/usr/bin/env node
// Free helper for run-lite-konductor-v2.sh. No model call; reads result.json files and moves .done markers only.
//   node lite-fill.js skipped DIR              print how many runs under DIR have status budget_skipped
//   node lite-fill.js table OUT.md DIR...      add one visible "budget_skipped" row per skipped run to OUT.md
//                                              (bench's pilot-table.js drops them: pilot-table.js:242)
//   node lite-fill.js reopen ROOT [--dry]      for each runs/r*/t*.done whose batch holds a budget_skipped run, move
//                                              the .done marker to ROOT/incomplete/ (rename, never delete) so --resume
//                                              fills the missing pairs. --dry only lists them.
// A batch dir looks like DIR/<arm>/<task>/<rep>/result.json.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function results(dir) {
  const out = [];
  const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const arm of ls(dir)) {
    for (const task of ls(path.join(dir, arm))) {
      for (const rep of ls(path.join(dir, arm, task))) {
        const f = path.join(dir, arm, task, rep, 'result.json');
        try { out.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* no result yet */ }
      }
    }
  }
  return out;
}
const skippedOf = (dir) => results(dir).filter((r) => r.status === 'budget_skipped');

const HEADER = ['| task | arm | rep | handEdited | singleFamily | score | time s | credits | flags | loads |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

function table(out, dirs) {
  const rows = dirs.flatMap(skippedOf)
    .sort((a, b) => `${a.taskId} ${a.armId} ${a.replicate}`.localeCompare(`${b.taskId} ${b.armId} ${b.replicate}`))
    .map((r) => `| ${r.taskId} | ${r.armId} | ${r.replicate} | - | - | - | - | - | **budget_skipped** (${cell(r.error) || 'budget reached'}) | - |`);
  if (!rows.length) return 0;
  const lines = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n') : [];
  const head = lines.findIndex((l) => l.startsWith('| task | arm |'));
  if (head < 0) {
    fs.writeFileSync(out, [...HEADER, ...rows, '', ...lines].join('\n'));
  } else {
    let end = head + 1;
    while (end < lines.length && lines[end].startsWith('|')) end++;
    lines.splice(end, 0, ...rows);
    fs.writeFileSync(out, lines.join('\n'));
  }
  console.log(`${rows.length} budget_skipped row(s) added to ${out}`);
  return 0;
}

function reopen(root, dry) {
  const runs = path.join(root, 'runs');
  let n = 0;
  for (const rep of fs.existsSync(runs) ? fs.readdirSync(runs).filter((x) => /^r\d+$/.test(x)).sort() : []) {
    for (const m of fs.readdirSync(path.join(runs, rep)).filter((x) => /^t\d+\.done$/.test(x)).sort()) {
      const b = m.slice(0, -5);
      const s = skippedOf(path.join(runs, rep, b));
      if (!s.length) continue;
      n++;
      const what = s.map((r) => `${r.armId}/${r.taskId}`).join(', ');
      if (dry) { console.log(`would reopen ${rep} ${b}: ${s.length} budget_skipped (${what})`); continue; }
      fs.mkdirSync(path.join(root, 'incomplete'), { recursive: true });
      const to = path.join(root, 'incomplete', `${rep}-${b}.done.${Date.now()}`);
      fs.renameSync(path.join(runs, rep, m), to);
      console.log(`reopened ${rep} ${b}: ${s.length} budget_skipped (${what}); marker moved to ${to}`);
    }
  }
  if (!n) console.log('no finished batch holds a budget_skipped run');
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'skipped') console.log(skippedOf(rest[0]).length);
  else if (cmd === 'table') process.exitCode = table(rest[0], rest.slice(1));
  else if (cmd === 'reopen') process.exitCode = reopen(rest[0], rest[1] === '--dry');
  else { console.error('usage: see the top of lite-fill.js'); process.exitCode = 64; }
} catch (e) { console.error(`lite-fill ${cmd}: ${e.message}`); process.exitCode = 1; }
