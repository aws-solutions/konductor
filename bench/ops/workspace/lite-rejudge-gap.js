#!/usr/bin/env node
'use strict';
// Judged gap per task, first pass against the re-judge, from judgments.json only (no model call).
//   node lite-rejudge-gap.js JUDGE_DIR > JUDGE_DIR/rejudge-gap.md
// Per run: the median over judges of the record score (the recorded quote view). Per task and arm: the mean over runs.
// Gap = konductor minus vanilla, times 100. These are the numbers that replace the "judged" half of the gap column in
// cause-analysis.md.
const fs = require('node:fs');
const path = require('node:path');

const J = process.argv[2];
function load(sub) {
  const per = new Map(); // task|arm|rep -> [scores]
  const dir = path.join(J, sub);
  for (const unit of fs.readdirSync(dir)) {
    const file = path.join(dir, unit, 'judgments.json');
    if (!fs.existsSync(file)) continue;
    const rep = unit.split('-')[0];
    for (const r of JSON.parse(fs.readFileSync(file, 'utf8')).rubric || []) {
      if (r.judgeError || typeof r.score !== 'number') continue;
      const k = `${r.taskId}|${r.armId}|${rep}`;
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(r.score);
    }
  }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byTask = new Map(); // task -> arm -> [run scores]
  for (const [k, xs] of per) {
    const [task, arm] = k.split('|');
    if (!byTask.has(task)) byTask.set(task, {});
    (byTask.get(task)[arm] ??= []).push(median(xs));
  }
  const gap = new Map();
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const [task, arms] of byTask) if (arms.konductor && arms.vanilla) gap.set(task, { k: 100 * mean(arms.konductor), v: 100 * mean(arms.vanilla) });
  return gap;
}
const before = load('runs');
const after = load('rejudge-runs');
const f = (x) => (x === undefined ? 'n/a' : x.toFixed(1));
const sign = (x) => (x === undefined ? 'n/a' : `${x >= 0 ? '+' : ''}${x.toFixed(1)}`);
console.log('| task | K before | V before | gap before | K after | V after | gap after |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const task of [...before.keys()].sort()) {
  const b = before.get(task);
  const a = after.get(task);
  console.log(`| ${task} | ${f(b.k)} | ${f(b.v)} | ${sign(b.k - b.v)} | ${f(a?.k)} | ${f(a?.v)} | ${a ? sign(a.k - a.v) : 'n/a'} |`);
}
