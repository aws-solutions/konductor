#!/usr/bin/env node
'use strict';
// Free estimate for run-lite-rejudge.sh --plan. Reads the first pass's judgments under judge/runs (no model call).
//   node lite-rejudge-estimate.js JUDGE_RUNS_DIR CAP_USD
// Prints: rubric records, first calls not in the cache (each unit's judge/cache is copied, so every other first call
// is free), records the re-ask would fire on (a pass or partial whose evidence the lenient rule did not find), the
// worst case (every record re-asked, each call at USD 0.05, the bench guard's per-call worst) and the expected spend
// (re-asks plus uncached calls at the first pass's mean live call cost).
const fs = require('node:fs');
const path = require('node:path');

const [dir, capArg] = process.argv.slice(2);
const cap = Number(capArg);
const WORST_PER_CALL = 0.05;
let records = 0, reask = 0, uncached = 0, liveUsd = 0, liveCalls = 0;
const byJudge = {};
for (const unit of fs.readdirSync(dir)) {
  const file = path.join(dir, unit, 'judgments.json');
  if (!fs.existsSync(file)) continue;
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8')).rubric || []) {
    for (const c of r.calls || []) if (!c.cached && c.usd > 0) { liveUsd += c.usd; liveCalls++; }
    if (r.judgeError || !r.criteria?.length) { uncached++; continue; }
    records++;
    if (r.criteria.some((c) => c.verdictRaw !== 'fail' && c.quoteFound?.lenient === false)) { reask++; byJudge[r.judge] = (byJudge[r.judge] || 0) + 1; }
  }
}
const mean = liveCalls ? liveUsd / liveCalls : WORST_PER_CALL;
const expectedCalls = uncached + reask;
const worstCalls = uncached + records;
console.log(`rubric records ${records}; first calls not cached ${uncached}; re-asks expected ${reask} (${Object.entries(byJudge).map(([j, n]) => `${j} ${n}`).join(', ')})`);
console.log(`live calls: expected ${expectedCalls}, at most ${worstCalls}`);
console.log(`USD: expected ${(expectedCalls * mean).toFixed(2)} (mean live call ${mean.toFixed(4)}); worst case ${(worstCalls * WORST_PER_CALL).toFixed(2)} at ${WORST_PER_CALL} a call; cap ${cap.toFixed(2)}, so the guard stops at most ${Math.floor(cap / WORST_PER_CALL)} worst-case calls in`);
