#!/usr/bin/env node
// Free helper for run-lite-konductor.sh and run-lite-judge.sh. No model call; reads files only.
//   node lite-helper.js gate R COST_JSON TASK,TASK...   which tasks may run, the skipped ones and why, ceilings per batch
//   node lite-helper.js spent R DIR                     real agent credits charged under DIR (every credit-ledger.jsonl)
//   node lite-helper.js stage R DIR...                  stage-A check: broken or timed-out share per arm (exit 1 over 10%)
//   node lite-helper.js summary R OUT.md DIR...         code-score gap table, konductor minus vanilla, per task
//   node lite-helper.js judge-spent DIR                 USD charged by judge calls under DIR
//   node lite-helper.js code-only R PACK                task ids in PACK with no judge items (code-only, never judged)
// R is the pinned bench worktree. A recheck clears a task only when it is by a non-Claude family and covers the
// task's current version (review.recheck.version, or content-lock legacyRecheckVersion for an older recheck).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [cmd, R, ...rest] = process.argv.slice(2);
const need = (m) => require(path.join(R, m));

// Per-run limit per batch: pilot-wave.sh's value times 1.5 for the konductor arm. It flags a run; it stops none (D-67).
const RUN_LIMIT = { t1: 23, t2: 23, t3: 23, t4: 30, t5: 23, t6: 68, t7: 15, t8: 23, t9: 15, t10: 38, t11: 23, t12: 30 };
const KRATIO = 1.5; // konductor run cost over plain, the highest Kiro ratio of the 2x2 study
const MARGIN = 1.5; // per-batch ceiling over the expected spend of one replicate
const CLAUDE = /claude|anthropic/i;

function ledgers(dir) {
  const out = [];
  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory() && e.name !== 'workspace' && e.name !== 'node_modules') walk(path.join(d, e.name));
      else if (e.name === 'credit-ledger.jsonl') out.push(d);
    }
  };
  walk(dir);
  return out;
}

function gate(costFile, ids) {
  const { readiness } = need('bench/scenarios/ready.js');
  const { loadTaskFiles } = need('bench/scenarios/files.js');
  const pack = path.join(R, 'bench/scenarios');
  const lock = JSON.parse(fs.readFileSync(path.join(pack, 'content-lock.json'), 'utf8')).tasks;
  const ready = new Map(readiness(pack).map((r) => [r.id, r]));
  const tasks = new Map(loadTaskFiles(pack).map(({ task }) => [task.id, task]));
  const cost = new Map(JSON.parse(fs.readFileSync(costFile, 'utf8')).map((r) => [r.id, r.credits]));
  const run = []; const skipped = [];
  for (const id of ids) {
    const t = tasks.get(id); const r = ready.get(id);
    const skip = (why, needs) => skipped.push({ id, why, needs });
    if (!t || !r) { skip('not in the pack at this head', 'the task file back in bench/scenarios'); continue; }
    const v = t.version; const rc = t.review?.recheck;
    if (!r.ready) { skip(`not ready: ${r.reasons.join('; ')}`, 'a passing dry run (scenarios ready)'); continue; }
    if (r.lockBlockers.length) { skip(`lock blocked: ${r.lockBlockers.join('; ')}`, `a version bump and a non-Claude recheck of the new version (D-150)`); continue; }
    if (!rc) { skip(`no recheck at v${v}`, `a non-Claude recheck of v${v}`); continue; }
    const fam = `${rc.family || ''} ${rc.model || ''}`;
    if (!rc.family || CLAUDE.test(fam)) { skip(`recheck family "${fam.trim() || 'unknown'}" is not a named non-Claude family`, `a non-Claude recheck of v${v}`); continue; }
    const covers = Number.isInteger(rc.version) ? rc.version : lock[id]?.legacyRecheckVersion;
    if (!Number.isInteger(covers) || covers < v) { skip(`recheck covers v${covers ?? '?'}, task is v${v}`, `a non-Claude recheck of v${v}`); continue; }
    const failed = (rc.items || []).filter((i) => i.verdict === 'fail').map((i) => i.check);
    if (failed.length) { skip(`recheck at v${v} failed: ${failed.join(', ')}`, `a fix, a version bump and a passing recheck`); continue; }
    if (!Number.isFinite(cost.get(id))) { skip('no pilot cost to size its batch ceiling', 'a pilot run'); continue; }
    run.push({ id, batch: r.batch, version: v, recheck: `${rc.model || rc.family}@v${covers}`, credits: cost.get(id) });
  }
  const batches = {};
  for (const t of run) (batches[t.batch] = batches[t.batch] || { tasks: [], expected: 0 }).tasks.push(t.id), batches[t.batch].expected += t.credits * (1 + KRATIO);
  for (const [b, x] of Object.entries(batches)) {
    x.expected = Math.round(x.expected * 10) / 10;
    x.ceiling = Math.max(10, Math.ceil(x.expected * MARGIN));
    x.runLimit = RUN_LIMIT[b] ?? 23;
  }
  const perRep = run.reduce((n, t) => n + t.credits * (1 + KRATIO), 0);
  return { run, skipped, batches, expectedPerReplicate: Math.round(perRep), expectedThreeReplicates: Math.round(perRep * 3) };
}

function spent(dir) {
  const { readLedger } = need('bench/runner/lib/credit-ledger.js');
  let total = 0; let unknown = 0;
  for (const d of ledgers(dir)) { const t = readLedger(d).totals; total += t.run; unknown += t.unknown; }
  return { credits: Math.round(total * 100) / 100, unknown };
}

// Rows per run directory, merged so a later directory's row replaces an earlier one for the same arm, task and rep.
// A budget-skipped cell never ran: newer bench commits return it as a row with `skipped: true` and no score (paired
// fill), and it must not count as a clean run or as a konductor run with no skill load (DEBT D-160). Older pins never
// return such a row, so this changes nothing for them.
function rows(dirs, { keepSkipped = false } = {}) {
  const { pilotRows } = need('bench/scenarios/pilot-table.js');
  const m = new Map();
  for (const d of dirs) {
    if (!fs.existsSync(path.join(d, 'run-config.json'))) continue;
    for (const r of pilotRows([d])) m.set(`${r.arm}|${r.task}|${r.rep}`, r);
  }
  return [...m.values()].filter((r) => keepSkipped || !r.skipped);
}
const isBroken = (r) => Boolean(r.flags?.broken || r.flags?.throttled);

function stage(dirs) {
  const by = {};
  for (const r of rows(dirs)) { const a = (by[r.arm] = by[r.arm] || { runs: 0, broken: 0 }); a.runs++; if (isBroken(r)) a.broken++; }
  let ok = Object.keys(by).length >= 2; // both arms must have runs
  for (const [arm, a] of Object.entries(by)) {
    const share = a.runs ? a.broken / a.runs : 1;
    if (share > 0.1) ok = false;
    console.log(`${arm}: ${a.broken} of ${a.runs} runs broken, throttled or timed out (${Math.round(share * 100)}%)`);
  }
  console.log(ok ? 'stage A clean (10% or less per arm)' : 'stage A NOT clean: over 10% broken in an arm, or no runs');
  return ok ? 0 : 1;
}

function summary(out, dirs) {
  const all = rows(dirs);
  const tasks = [...new Set(all.map((r) => r.task))].sort();
  const arms = [...new Set(all.map((r) => r.arm))].sort();
  const kon = arms.find((a) => a !== 'vanilla');
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const f = (x) => (x === null ? '-' : x.toFixed(1));
  const L = ['| task | vanilla code | konductor code | gap | runs v/k | konductor runs with no skill load | broken v/k | credits v/k |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  const gaps = []; const cr = { vanilla: 0, [kon]: 0 };
  for (const t of tasks) {
    const of = (a) => all.filter((r) => r.task === t && r.arm === a);
    const good = (a) => of(a).filter((r) => !isBroken(r) && Number.isFinite(r.score)).map((r) => r.score);
    const v = mean(good('vanilla')); const k = mean(good(kon));
    const gap = v !== null && k !== null ? k - v : null;
    if (gap !== null) gaps.push(gap);
    for (const a of ['vanilla', kon]) cr[a] += of(a).reduce((n, r) => n + (r.credits || 0), 0);
    const noLoad = of(kon).filter((r) => !(r.loads || []).length).length;
    L.push(`| ${t} | ${f(v)} | ${f(k)} | ${f(gap)} | ${good('vanilla').length}/${good(kon).length} | ${noLoad} of ${of(kon).length} | ${of('vanilla').filter(isBroken).length}/${of(kon).filter(isBroken).length} | ${of('vanilla').reduce((n, r) => n + (r.credits || 0), 0).toFixed(1)}/${of(kon).reduce((n, r) => n + (r.credits || 0), 0).toFixed(1)} |`);
  }
  L.push('', `Mean code gap over ${gaps.length} task(s), konductor minus vanilla: ${f(mean(gaps))}. Code part only; the judged part and the 95% range come from run-lite-judge.sh.`);
  L.push(`Credits: vanilla ${cr.vanilla.toFixed(1)}, ${kon} ${(cr[kon] || 0).toFixed(1)}.`);
  fs.writeFileSync(out, `${L.join('\n')}\n`);
  return 0;
}

// Task ids in PACK whose judged rubric is empty (no rubric and no expertKey): a judge can only fail them, so they stay
// code-only and are left out of the judge copy.
function codeOnly(pack) {
  const { loadTasks } = need('bench/runner/lib/tasks.js');
  const { judgedRubric } = need('bench/runner/lib/expert-rubric.js');
  const ts = loadTasks(path.join(R, 'bench'), { extraDirs: [pack] });
  const all = ts instanceof Map ? [...ts.values()] : Object.values(ts);
  const own = new Set(fs.readdirSync(pack).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  return all.filter((t) => own.has(t.id) && !(judgedRubric(t.rubric, t.expertKey) || []).length).map((t) => t.id);
}

function judgeSpent(dir) {
  let usd = 0;
  for (const d of ledgers(dir)) {
    for (const line of fs.readFileSync(path.join(d, 'credit-ledger.jsonl'), 'utf8').split('\n')) {
      try { const e = JSON.parse(line); if (e.unit === 'usd' && Number.isFinite(e.usd)) usd += e.usd; } catch { /* partial line */ }
    }
  }
  return Math.round(usd * 10000) / 10000;
}

try {
  if (cmd === 'gate') console.log(JSON.stringify(gate(rest[0], rest[1].split(',').filter(Boolean)), null, 2));
  else if (cmd === 'spent') console.log(JSON.stringify(spent(rest[0])));
  else if (cmd === 'stage') process.exitCode = stage(rest);
  else if (cmd === 'summary') process.exitCode = summary(rest[0], rest.slice(1));
  else if (cmd === 'judge-spent') console.log(judgeSpent(R));
  else if (cmd === 'code-only') console.log(codeOnly(rest[0]).join(' '));
  else { console.error('usage: see the top of lite-helper.js'); process.exitCode = 64; }
} catch (e) { console.error(`lite-helper ${cmd}: ${e.message}`); process.exitCode = 1; }
