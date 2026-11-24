#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Free helper for run-standard.sh, judge-standard.sh and claude-standard.sh. No model call; reads files only.
//   node helper.js plan R [COST_JSON]          STANDARD task list (bench --level standard over suites/pack.json), the
//                                              gated ones per batch, the skipped ones and why, run limits
//   node helper.js cc-plan R PLAN              the Claude Code arms over the frozen plan: arms, expected USD per batch
//                                              and per stage (the measured USD per plain Kiro credit times the arm ratios)
//   node helper.js stage R [--arms A,B,C[,D]] DIR...  stage check: every arm has runs, broken share 10% or less each
//   node helper.js summary R [--arms A,B,C[,D]] OUT.md DIR...  code-score table per task: the arms in order (plain,
//                                              konductor, noskills, and the list-hook arm when given) and their gaps
//   node helper.js cc-tasks R PLAN N           N task ids for a Claude Code subset: the bench's LITE picks that STANDARD
//                                              runs, then the rest of the plan by lowest SR-32 hash
//   node helper.js spent R DIR                 {credits, unknown}: real agent credits under DIR (every credit-ledger.jsonl)
//   node helper.js usd-spent R DIR             USD the agent runs under DIR cost (result.json costUsd: Claude Code)
//   node helper.js judge-spent R DIR           USD charged by judge calls under DIR (ledger entries with unit usd)
//   node helper.js code-only R PACK            task ids in PACK with no judge items (code-only, never judged)
// R is the pinned bench worktree. The gate rules: ready, no lock blocker, a passing non-Claude recheck that covers the
// current version (review.recheck.version, or content-lock legacyRecheckVersion). A task with no pilot cost is not
// skipped; it takes its batch mean (the plan's cost rule).
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const [cmd, rArg, ...rest] = process.argv.slice(2);
const R = path.resolve(rArg || '.'); // a relative R would make require() look for a package named "bench"
const need = (m) => require(path.join(R, m));

// Per-run limit per batch: pilot-wave.sh's value times 1.5 for the konductor arm. It flags a run; it stops none (D-67), so the stage cap keeps a margin.
const RUN_LIMIT = { t1: 23, t2: 23, t3: 23, t4: 30, t5: 23, t6: 68, t7: 15, t8: 23, t9: 15, t10: 38, t11: 23, t12: 30 };
// The plan's cost rule per arm, plain = 1; konductor-list (the skill-list prompt hook) is planned at 1.6, measured 1.43.
const RATIO = { vanilla: 1, konductor: 1.5, 'konductor-noskills': 1.25, 'konductor-list': 1.6 };
const DEFAULT_COST = 4; // the pilot mean per plain run (3.97), for a batch with no piloted task at all
const ARMS = ['vanilla', 'konductor', 'konductor-noskills', 'konductor-list'];
// Claude Code arms (the same conditions under the cc- prefix) and their USD model: the skill-loading study's 8 LITE tasks
// cost USD 0.360 a plain run against 5.08 plain Kiro credits (USD 0.071 a credit), and a konductor run 1.59 times a
// plain one (0.573 against 0.360); noskills sits between at 1.3. A task's size is its pilot plain credits.
const CC_PREFIX = 'cc-';
const CC_USD_PER_PLAIN_CREDIT = 0.071;
const CC_RATIO = { 'cc-vanilla': 1, 'cc-konductor': 1.59, 'cc-konductor-noskills': 1.3 };
const CLAUDE = /claude|anthropic/i;

// `--arms A,B,C` at the front of `rest`, else `fallback`; returns { arms, rest }.
function armsOpt(rest, fallback) {
  if (rest[0] === '--arms') return { arms: rest[1].split(',').filter(Boolean), rest: rest.slice(2) };
  return { arms: fallback, rest };
}

function devTasks() {
  const { loadTasks } = need('bench/runner/lib/tasks.js');
  const { selectLevel } = need('bench/scenarios/levels.js');
  const bench = path.join(R, 'bench');
  const suite = JSON.parse(fs.readFileSync(path.join(bench, 'suites/pack.json'), 'utf8'));
  const all = loadTasks(bench, { extraDirs: suite.extraTasks.map((d) => path.join(bench, d)) });
  const tasks = suite.tasks.map((id) => all.get(id)).filter(Boolean);
  return { sel: selectLevel({ level: 'standard', tasks }), tasks };
}

function plan(costFile) {
  const { readiness } = need('bench/scenarios/ready.js');
  const { loadTaskFiles } = need('bench/scenarios/files.js');
  const pack = path.join(R, 'bench/scenarios');
  const lock = JSON.parse(fs.readFileSync(path.join(pack, 'content-lock.json'), 'utf8')).tasks;
  const ready = new Map(readiness(pack).map((r) => [r.id, r]));
  const taskFiles = loadTaskFiles(pack);
  const files = new Map(taskFiles.map(({ task }) => [task.id, task]));
  // readiness() reads the t<N> batches only. A task in another pack dir (probe/) gets the same fix and lock rules
  // here, with its dir as its batch; its dry run is that dir's own test (probe.test.js), not `scenarios ready`.
  const { fixReasons, lockBlockers } = need('bench/scenarios/ready.js');
  const content = new Map(need('bench/scenarios/content-lock.js').compare(pack).map((c) => [c.id, c]));
  for (const { task, file } of taskFiles) {
    if (ready.has(task.id)) continue;
    const fix = fixReasons(task);
    ready.set(task.id, { batch: path.basename(path.dirname(file)), ready: !fix.length, reasons: fix, lockBlockers: lockBlockers(task, content.get(task.id)) });
  }
  const cost = new Map(costFile && fs.existsSync(costFile) ? JSON.parse(fs.readFileSync(costFile, 'utf8')).map((r) => [r.id, r.credits]) : []);
  const { sel } = devTasks();
  const run = []; const skipped = [];
  for (const id of sel.ids) {
    const t = files.get(id); const r = ready.get(id);
    const skip = (why, needs) => skipped.push({ id, why, needs });
    if (!t || !r) { skip('not in the scenario pack', 'a task file under bench/scenarios'); continue; }
    const v = t.version; const rc = t.review?.recheck;
    if (!r.ready) { skip(`not ready: ${r.reasons.join('; ')}`, 'a passing dry run (scenarios ready)'); continue; }
    if (r.lockBlockers.length) { skip(`lock blocked: ${r.lockBlockers.join('; ')}`, 'a version bump and a non-Claude recheck of the new version (D-150)'); continue; }
    if (!rc) { skip(`no recheck at v${v}`, `a non-Claude recheck of v${v}`); continue; }
    const fam = `${rc.family || ''} ${rc.model || ''}`;
    if (!rc.family || CLAUDE.test(fam)) { skip(`recheck family "${fam.trim() || 'unknown'}" is not a named non-Claude family`, `a non-Claude recheck of v${v}`); continue; }
    const covers = Number.isInteger(rc.version) ? rc.version : lock[id]?.legacyRecheckVersion;
    if (!Number.isInteger(covers) || covers < v) { skip(`recheck covers v${covers ?? '?'}, task is v${v}`, `a non-Claude recheck of v${v}`); continue; }
    const failed = (rc.items || []).filter((i) => i.verdict === 'fail').map((i) => i.check);
    if (failed.length) { skip(`recheck at v${v} failed: ${failed.join(', ')}`, 'a fix, a version bump and a passing recheck'); continue; }
    run.push({ id, batch: r.batch, version: v, recheck: `${rc.model || rc.family}@v${covers}`, credits: cost.get(id) ?? null });
  }
  const batches = {};
  for (const t of run) (batches[t.batch] = batches[t.batch] || { tasks: [], piloted: [] }).tasks.push(t.id);
  const per = Object.values(RATIO).reduce((a, b) => a + b, 0);
  let perStage = 0;
  for (const [b, x] of Object.entries(batches)) {
    const known = run.filter((t) => t.batch === b && Number.isFinite(t.credits)).map((t) => t.credits);
    const mean = known.length ? known.reduce((a, c) => a + c, 0) / known.length : DEFAULT_COST;
    x.piloted = known.length;
    x.expected = Math.round(run.filter((t) => t.batch === b).reduce((n, t) => n + (Number.isFinite(t.credits) ? t.credits : mean) * per, 0) * 10) / 10;
    x.runLimit = RUN_LIMIT[b] ?? 23;
    perStage += x.expected;
  }
  return { level: 'standard', listHash: sel.listHash, levelIds: sel.ids, run, skipped, batches, expectedPerStage: Math.round(perStage) };
}

// Rows per run directory, merged so a later directory's row replaces an earlier one for the same arm, task and rep;
// budget-skipped cells never ran and are left out (DEBT D-160).
function rows(dirs) {
  const { pilotRows } = need('bench/scenarios/pilot-table.js');
  const m = new Map();
  for (const d of dirs) {
    if (!fs.existsSync(path.join(d, 'run-config.json'))) continue;
    for (const r of pilotRows([d])) m.set(`${r.arm}|${r.task}|${r.rep}`, r);
  }
  return [...m.values()].filter((r) => !r.skipped);
}
const isBroken = (r) => Boolean(r.flags?.broken || r.flags?.throttled);

function stage(dirs, arms = ARMS) {
  const by = Object.fromEntries(arms.map((a) => [a, { runs: 0, broken: 0 }]));
  for (const r of rows(dirs)) { const a = (by[r.arm] = by[r.arm] || { runs: 0, broken: 0 }); a.runs++; if (isBroken(r)) a.broken++; }
  let ok = true;
  for (const [arm, a] of Object.entries(by)) {
    const share = a.runs ? a.broken / a.runs : 1;
    if (share > 0.1) ok = false;
    console.log(`${arm}: ${a.broken} of ${a.runs} runs broken, throttled or timed out (${Math.round(share * 100)}%)`);
  }
  console.log(ok ? `stage clean (10% or less per arm, all ${arms.length} arms ran)` : 'stage NOT clean: over 10% broken in an arm, or an arm with no runs');
  return ok ? 0 : 1;
}

// `arms` in order: plain, konductor, noskills, and optionally the list-hook arm (the Kiro arms or their cc- twins).
function summary(out, dirs, arms = ARMS) {
  const all = rows(dirs);
  const tasks = [...new Set(all.map((r) => r.task))].sort();
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const f = (x) => (x === null ? '-' : x.toFixed(1));
  const gap = (a, b) => (a !== null && b !== null ? a - b : null);
  const [V, K, N, H] = arms;
  // Gap columns: head minus base, by arm index. The list arm adds list minus konductor and list minus noskills.
  const pairs = [[1, 2], [2, 0], ...(H ? [[3, 1], [3, 2]] : [])];
  const L = [`| task | ${arms.join(' | ')} | ${pairs.map(([h, b]) => `${arms[h]} - ${arms[b]}`).join(' | ')} | runs | broken |`, `| --- |${' --- |'.repeat(arms.length + pairs.length + 2)}`];
  const gaps = pairs.map(() => []); const cr = Object.fromEntries(arms.map((a) => [a, 0]));
  for (const t of tasks) {
    const of = (a) => all.filter((r) => r.task === t && r.arm === a);
    const good = (a) => of(a).filter((r) => !isBroken(r) && Number.isFinite(r.score)).map((r) => r.score);
    const means = arms.map((a) => mean(good(a)));
    const gs = pairs.map(([h, b]) => gap(means[h], means[b]));
    gs.forEach((g, i) => { if (g !== null) gaps[i].push(g); });
    for (const a of arms) cr[a] += of(a).reduce((s, r) => s + (r.credits || 0), 0);
    L.push(`| ${t} | ${means.map(f).join(' | ')} | ${gs.map(f).join(' | ')} | ${arms.map((a) => good(a).length).join('/')} | ${arms.map((a) => of(a).filter(isBroken).length).join('/')} |`);
  }
  L.push('', `Mean code gaps: ${pairs.map(([h, b], i) => `${arms[h]} minus ${arms[b]} over ${gaps[i].length} task(s): ${f(mean(gaps[i]))}`).join('; ')}.`);
  L.push(`Runs and broken are per arm in the order ${arms.join('/')}. Code part only, DEV, not a verdict. The judged part and the 95% ranges come from judge-standard.sh (bench report).`);
  // Cost per arm: Kiro runs carry credits in their rows; Claude Code runs carry USD in result.json costUsd (usdSpent).
  const costOf = (a) => (a.startsWith(CC_PREFIX) ? dirs.reduce((s, d) => s + usdSpent(path.join(d, a)), 0) : cr[a]);
  L.push(`Cost (credits on Kiro CLI, USD on Claude Code): ${arms.map((a) => `${a} ${costOf(a).toFixed(2)}`).join(', ')}.`);
  fs.writeFileSync(out, `${L.join('\n')}\n`);
  return 0;
}

// The Claude Code arms over a frozen plan: the same conditions under the cc- prefix (the noskills tree is the plan's),
// and the expected USD per batch and per stage from each batch's plain pilot credits (expected / the Kiro ratio sum).
function ccPlan(planFile) {
  const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const arms = [`${CC_PREFIX}vanilla`, `${CC_PREFIX}konductor=${p.konductorSha}`, `${CC_PREFIX}${p.noskillsArm}`];
  const kiroPer = Object.values(RATIO).reduce((a, b) => a + b, 0);
  const ccPer = Object.values(CC_RATIO).reduce((a, b) => a + b, 0);
  const batches = {}; let perStage = 0;
  for (const [b, x] of Object.entries(p.batches)) {
    const plainCredits = x.expected / kiroPer;
    const usd = Math.round(plainCredits * CC_USD_PER_PLAIN_CREDIT * ccPer * 100) / 100;
    batches[b] = { tasks: x.tasks, expectedUsd: usd };
    perStage += usd;
  }
  return { arms, armIds: Object.keys(CC_RATIO), usdPerPlainCredit: CC_USD_PER_PLAIN_CREDIT, ratio: CC_RATIO, batches, expectedUsdPerStage: Math.round(perStage * 100) / 100, runsPerStage: p.run.length * arms.length };
}

function ccTasks(planFile, n) {
  const { liteSelection } = need('bench/scenarios/levels.js');
  const { hashOf } = need('bench/scenarios/split.js');
  const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const runs = new Set(p.run.map((t) => t.id));
  const { tasks } = devTasks();
  const lite = liteSelection(tasks).picks.map((x) => x.id).filter((id) => runs.has(id));
  const byHash = (a, b) => (hashOf(a) < hashOf(b) ? -1 : hashOf(a) > hashOf(b) ? 1 : 0);
  const rest = [...runs].filter((id) => !lite.includes(id)).sort(byHash);
  return [...lite.sort(byHash), ...rest].slice(0, n);
}

// Claude Code runs carry their cost in result.json costUsd, not in credit-ledger.jsonl (orchestrate.js USD).
function usdSpent(dir) {
  let usd = 0;
  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory() && e.name !== 'workspace' && e.name !== 'node_modules') walk(path.join(d, e.name));
      else if (e.name === 'result.json') {
        try { const c = JSON.parse(fs.readFileSync(path.join(d, e.name), 'utf8')).costUsd; if (Number.isFinite(c)) usd += c; } catch { /* partial file */ }
      }
    }
  };
  walk(dir);
  return Math.round(usd * 10000) / 10000;
}

// Every directory under `dir` that holds a credit-ledger.jsonl (run workspaces and node_modules are skipped).
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

function spent(dir) {
  const { readLedger } = need('bench/runner/lib/credit-ledger.js');
  let total = 0; let unknown = 0;
  for (const d of ledgers(dir)) { const t = readLedger(d).totals; total += t.run; unknown += t.unknown; }
  return { credits: Math.round(total * 100) / 100, unknown };
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

// Task ids in PACK whose judged rubric is empty (no rubric and no expertKey): a judge can only fail them.
function codeOnly(pack) {
  const { loadTasks } = need('bench/runner/lib/tasks.js');
  const { judgedRubric } = need('bench/runner/lib/expert-rubric.js');
  const ts = loadTasks(path.join(R, 'bench'), { extraDirs: [pack] });
  const all = ts instanceof Map ? [...ts.values()] : Object.values(ts);
  const own = new Set(fs.readdirSync(pack).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  return all.filter((t) => own.has(t.id) && !(judgedRubric(t.rubric, t.expertKey) || []).length).map((t) => t.id);
}

try {
  if (cmd === 'plan') console.log(JSON.stringify(plan(rest[0]), null, 2));
  else if (cmd === 'cc-plan') console.log(JSON.stringify(ccPlan(rest[0]), null, 2));
  else if (cmd === 'stage') { const o = armsOpt(rest, ARMS); process.exitCode = stage(o.rest, o.arms); }
  else if (cmd === 'summary') { const o = armsOpt(rest, ARMS); process.exitCode = summary(o.rest[0], o.rest.slice(1), o.arms); }
  else if (cmd === 'usd-spent') console.log(usdSpent(rest[0]));
  else if (cmd === 'spent') console.log(JSON.stringify(spent(rest[0])));
  else if (cmd === 'judge-spent') console.log(judgeSpent(rest[0]));
  else if (cmd === 'code-only') console.log(codeOnly(rest[0]).join(' '));
  else if (cmd === 'cc-tasks') console.log(ccTasks(rest[0], Number(rest[1]) || 15).join(','));
  else { console.error('usage: see the top of standard-helper.js'); process.exitCode = 64; }
} catch (e) { console.error(`standard-helper ${cmd}: ${e.message}`); process.exitCode = 1; }
