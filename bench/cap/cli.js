// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap list|audit|variant|plan`. Everything here is free: no model call, no credits, no network.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { resolveArm } = require('../runner/lib/arms.js');
const { prepareAll } = require('../runner/lib/orchestrate.js');
const { DEFAULT_ENGINE, AGENT_ENGINES } = require('../runner/lib/harness/runtime.js');
const sandbox = require('../runner/lib/sandbox.js');
const procs = require('../runner/lib/procs.js');
const { resolveBase } = require('./source.js');
const { scanRepo, loadAgentSpecs } = require('./scan.js');
const { loadRegistry } = require('./registry.js');
const { kiroReachers } = require('./reach.js');
const { runAudit, renderAudit } = require('./audit.js');
const { baselineUpdate } = require('./baseline.js');
const { buildVariant, verifyInstalled, reachWarning, checkScratch } = require('./variant.js');
const { planCap } = require('./plan.js');
const { guardInstalls } = require('./guard.js');
const { EXPECTED_TOOL, ID_RE } = require('./registry.js');
const { makeCapCaller, DEFAULT_MODEL } = require('./model.js');
const { draftCapability, importQueries, writeDraft } = require('./draft.js');
const trig = require('./trigger.js');
const { runProxy, summarizeProxy, proxySupported } = require('./proxy.js');
const { kiroSurface, opencodeSurface } = require('./surface.js');
const { scoreTrigger, crossCheck } = require('./score.js');
const { cmdRun } = require('../runner/lib/run-cmd.js');
const { loadRun } = require('../report/load.js');
const { seedOf } = require('../runner/lib/pr-plan.js');

const SUBCOMMANDS = ['list', 'audit', 'variant', 'plan', 'draft', 'import', 'trigger'];
const DEFAULT_BASE = 'v1.2.0';

class Refusal extends Error {}

const list = (v) => (v === undefined || v === true || v === '' ? [] : String(v).split(',').filter(Boolean));
const pathOpt = (v) => (v && v !== true ? path.resolve(v) : null);

function common(opts) {
  const repo = path.resolve(opts['repo-root'] && opts['repo-root'] !== true ? opts['repo-root'] : process.env.BENCH_REPO_ROOT || path.resolve(BENCH_DIR, '..'));
  const benchDir = pathOpt(opts['bench-dir']) ?? BENCH_DIR;
  const base = opts.base && opts.base !== true ? String(opts.base) : DEFAULT_BASE;
  return { repo, benchDir, base, extraTasks: list(opts['extra-tasks']).map((d) => path.resolve(d)) };
}

function engineOf(opts) {
  const v = opts['agent-engine'];
  if (v === undefined) return DEFAULT_ENGINE;
  if (!AGENT_ENGINES.includes(v)) throw new Error(`--agent-engine must be ${AGENT_ENGINES.join(' or ')}`);
  return v;
}

const pad = (rows) => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd()).join('\n');
};

function selector(opts) {
  const ids = list(opts.cap);
  const kinds = list(opts.kind);
  return (c) => (!ids.length || ids.includes(c.id)) && (!kinds.length || kinds.includes(c.kind));
}

// ---- list ----

function skeletonFor(c, specs) {
  const acting = kiroReachers(c.id, specs);
  return {
    id: c.id, kind: c.kind, path: c.path, owner: '', class: 'uplift',
    tasks: { lift: [], trigger: [], headroom: {} },
    trigger: { gen: 1, queries: [] },
    expect: { 'kiro-cli': { tool: EXPECTED_TOOL['kiro-cli'][c.kind], ...(acting.length ? { actingAgents: acting } : {}) }, opencode: { tool: EXPECTED_TOOL.opencode[c.kind] } },
    notes: '',
  };
}

function cmdList(opts) {
  const { repo, benchDir, base, extraTasks } = common(opts);
  const { report } = runAudit({ repo, base, harness: 'both', benchDir, extraTasks });
  const pick = selector(opts);
  const caps = report.capabilities.filter(pick);
  if (opts.init) {
    const b = resolveBase(base, repo);
    try {
      const scan = scanRepo(b.dir);
      const specs = loadAgentSpecs(b.dir);
      const entries = caps.filter((c) => !c.registered).map((c) => ({ file: `capabilities/${c.kind}/${c.name}.json`, entry: skeletonFor(scan.get(c.id), specs) }));
      if (opts.json) console.log(JSON.stringify(entries, null, 2));
      else for (const e of entries) console.log(`# ${e.file}  (owner must be filled in; nothing was written)\n${JSON.stringify(e.entry, null, 2)}\n`);
      console.error(`${entries.length} unregistered capabilit${entries.length === 1 ? 'y' : 'ies'}; skeletons printed, no file written`);
    } finally { b.cleanup(); }
    process.exitCode = report.registry.findings.some((f) => f.level === 'error') ? 1 : 0;
    return;
  }
  if (opts.json) { console.log(JSON.stringify({ base: report.base, capabilities: caps, registry: report.registry }, null, 2)); }
  else {
    const rows = [['id', 'registered', 'owner', 'class', 'kiro agents', 'tasks', 'queries', 'gap']];
    for (const c of caps) {
      rows.push([c.id, c.registered ? 'yes' : '-', c.owner ?? '-', c.registered ? c.class : '-', c.reach.kiro ? c.reach.kiro.agents.length : '-', c.tasks.linked.length + c.tasks.byTarget.length, c.registered ? c.triggerQueries : '-', c.tasks.gap ?? '-']);
    }
    console.log(`Base ${report.base.label}; ${caps.length} capabilit${caps.length === 1 ? 'y' : 'ies'} (${report.summary.registered} registered in the repo)\n`);
    console.log(pad(rows));
    for (const c of caps.filter((x) => x.registered)) {
      console.log(`\n${c.id}: reached by ${c.reach.kiro.agents.join(', ') || 'no agent'} on kiro-cli; linked tasks ${c.tasks.linked.join(', ') || 'none'}; target-only tasks ${c.tasks.byTarget.join(', ') || 'none'}`);
    }
  }
  const regErrors = report.registry.findings.filter((f) => f.level === 'error');
  for (const f of report.registry.findings) console.error(`${f.level.toUpperCase()} ${f.where}: ${f.msg}`);
  process.exitCode = regErrors.length ? 1 : 0;
}

// ---- audit ----

function cmdAudit(opts) {
  const { repo, benchDir, base, extraTasks } = common(opts);
  const harness = opts.harness && opts.harness !== true ? opts.harness : 'both';
  const { report, exitCode } = runAudit({ repo, base, harness, benchDir, extraTasks, pub: Boolean(opts.public) });
  const outDir = pathOpt(opts.out) ?? path.join(os.tmpdir(), 'konductor-bench', 'cap', new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
  const outReal = checkScratch(outDir, repo);
  fs.writeFileSync(path.join(outReal, 'cap-audit.md'), renderAudit(report));
  fs.writeFileSync(path.join(outReal, 'cap-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else {
    const pick = selector(opts);
    const rows = [['capability', 'desc', 'chars', 'style', 'cue', 'bytes', 'tok~', 'kiro agents', 'nearest']];
    for (const c of report.capabilities.filter(pick)) {
      const n = c.neighbours[0];
      rows.push([c.id, c.description.present ? 'yes' : (c.kind === 'skill' ? 'NO' : '-'), c.description.length || '-', c.kind === 'skill' ? c.description.style : '-', c.kind === 'skill' ? (c.description.useWhen ? 'yes' : 'no') : '-', c.bytes, c.estTokens, c.reach.kiro ? c.reach.kiro.agents.length : '-', n ? `${n.id} ${n.score}` : '-']);
    }
    console.log(`Base ${report.base.label}${report.base.commitSha ? ` ${report.base.commitSha.slice(0, 10)}` : ''}; harness ${report.harness}; tokens are bytes/4, an estimate\n`);
    console.log(pad(rows));
    const counts = report.findings.reduce((m, f) => ({ ...m, [f.level]: (m[f.level] ?? 0) + 1 }), {});
    const byRule = report.findings.reduce((m, f) => ({ ...m, [`${f.level} ${f.rule}`]: (m[`${f.level} ${f.rule}`] ?? 0) + 1 }), {});
    console.log(`\nFindings: ${counts.error ?? 0} error, ${counts.warn ?? 0} warn`);
    for (const [k, v] of Object.entries(byRule).sort()) console.log(`  ${k}: ${v}`);
    for (const f of report.findings.filter((x) => x.level === 'error')) console.log(`ERROR ${f.rule}: ${f.msg}`);
    console.log(`\nwrote ${path.join(outReal, 'cap-audit.md')}\nwrote ${path.join(outReal, 'cap-audit.json')}`);
  }
  process.exitCode = exitCode;
  if (opts['update-baseline']) {
    const u = baselineUpdate({ report, benchDir, force: Boolean(opts.force) });
    if (u.written) console.log(`baseline: wrote ${u.file} (${u.count} waived${u.removed.length ? `, removed ${u.removed.length} stale` : ''}${u.added.length ? `, added ${u.added.length}` : ''})`);
    else { console.log(`baseline: NOT written; ${u.added.length} finding(s) are not in ${u.file} and a baseline only shrinks (pass --force to accept them):\n  ${u.added.join('\n  ')}`); process.exitCode = 2; }
  }
}

// ---- variant ----

function pseudoOps(opts) {
  const ops = [];
  if (opts.preset) ops.push({ op: 'preset', id: opts.preset });
  for (const id of list(opts.drop)) ops.push({ op: 'drop', id });
  for (const a of list(opts.replace)) ops.push({ op: 'replace', id: a.slice(0, Math.max(a.indexOf('='), 0)) });
  for (const a of list(opts.add)) ops.push({ op: 'add', id: a.slice(0, Math.max(a.indexOf('='), 0)), agents: list(opts['to-agent']) });
  return ops;
}

function checkReach(opts, repo, benchDir, base) {
  const ops = pseudoOps(opts);
  const first = ops.find((o) => o.op !== 'preset');
  if (!first) return null;
  const b = resolveBase(base, repo);
  try {
    const specs = loadAgentSpecs(b.dir);
    const reg = loadRegistry(benchDir).entries.find((e) => e.data?.id === first.id)?.data;
    const acting = list(opts['acting-agent']).length ? list(opts['acting-agent']) : reg?.expect?.['kiro-cli']?.actingAgents?.length ? reg.expect['kiro-cli'].actingAgents : ['konductor'];
    return reachWarning({ ops, specs, actingAgents: acting });
  } finally { b.cleanup(); }
}

function verifyVariant(v, opts, repo) {
  const cacheDir = path.resolve(pathOpt(opts.cache) ?? path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(pathOpt(opts['cargo-target']) ?? process.env.CARGO_TARGET_DIR ?? path.join(cacheDir, 'cargo-target'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  const log = (m) => console.error(`[cap ${new Date().toISOString().slice(11, 19)}] ${m}`);
  try {
    const arm = resolveArm(v.armSpec, repo);
    const ctx = { repo, cacheDir, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb: null, config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: v.meta.agentEngine }, envKeep: [] };
    let prepared;
    try {
      ({ prepared } = prepareAll({ arms: [arm], ctx, log, allowPartial: false }));
    } catch (e) {
      return { ok: false, prepareFailed: true, problems: [`the prepare-only path could not run: ${e.message.split('\n').slice(0, 6).join(' | ')}`] };
    }
    return verifyInstalled({ variant: v, prepared: prepared.get(arm.id), tmpRoot: scratchDir });
  } finally {
    procs.removeAllScratch();
  }
}

function cmdVariant(opts) {
  const { repo, benchDir, base } = common(opts);
  const scratch = pathOpt(opts.scratch) ?? path.join(os.tmpdir(), 'konductor-bench');
  const warn = checkReach(opts, repo, benchDir, base);
  if (warn && !opts.force) throw new Refusal(`${warn}. Pass --force to build it anyway`);
  if (warn) console.error(`WARNING: ${warn} (--force)`);
  const run = () => {
    const v = buildVariant({
      repo, base, drop: list(opts.drop), replace: list(opts.replace), add: list(opts.add), toAgent: list(opts['to-agent']),
      preset: opts.preset && opts.preset !== true ? opts.preset : null, scratch, agentEngine: engineOf(opts),
    });
    const verify = opts.verify ? verifyVariant(v, opts, repo) : null;
    return { v, verify };
  };
  const { v, verify } = guardInstalls(run);
  if (opts.json) console.log(JSON.stringify({ armSpec: v.armSpec, dir: v.dir, root: v.root, meta: v.meta, verify }, null, 2));
  else {
    console.log(`variant ${v.variantId} (arm ${v.armName}) from ${v.meta.base.ref}@${v.meta.base.commitSha.slice(0, 7)}, engine ${v.meta.agentEngine}`);
    console.log(`  tree:         ${v.dir}\n  variant.json: ${path.join(v.root, 'variant.json')}\n  variantHash:  ${v.meta.variantHash}`);
    for (const o of v.meta.ops) {
      const detail = o.removedFrom ? `removed from ${o.removedFrom.map((r) => `${r.agent}.${r.list}`).join(', ') || 'no list'}` : o.agents ? `added to ${o.agents.join(', ')}` : '';
      console.log(`  op ${o.op} ${o.id}${detail ? `: ${detail}` : ''}`);
    }
    for (const r of v.meta.inboundRefs) console.log(`  ${r.id} ${r.refs.length ? `referenced by: ${r.refs.map((x) => x.from).sort().join(', ')} (a dangling reference is a confound for the lift, not an error)` : 'has no inbound references'}`);
    console.log(`\nUse this arm:\n  --arms ${v.armSpec}`);
    if (verify) {
      console.log(verify.ok ? `\nverify: ok, installed filters match the ops for ${verify.checked.join(', ')}` : `\nverify: FAILED\n${verify.problems.map((p) => `  ${p}`).join('\n')}`);
    } else console.log('\nverify: not requested (add --verify to build and trial-install it with a scratch HOME; no credits)');
  }
  if (verify && !verify.ok) process.exitCode = 1;
}

// ---- plan ----

function cmdPlan(opts) {
  const { repo, benchDir, base, extraTasks } = common(opts);
  const p = planCap({
    mode: opts.mode, cap: opts.cap && opts.cap !== true ? opts.cap : undefined, base, reps: opts.reps === undefined ? undefined : opts.reps,
    tasks: list(opts.tasks), budgetCredits: opts['budget-credits'] === undefined ? null : Number(opts['budget-credits']),
    repoRoot: repo, benchDir, extraTasks, vanilla: Boolean(opts.vanilla), allowRegex: Boolean(opts['allow-regex']), force: Boolean(opts.force),
    candidate: pathOpt(opts.candidate), actingAgents: list(opts['acting-agent']), agentEngine: engineOf(opts), scratch: pathOpt(opts.scratch) ?? undefined,
    seed: opts.seed,
  });
  console.log(opts.json ? JSON.stringify(p, null, 2) : p.text);
}

// ---- draft and import ----

function intIn(v, name, min, max, dflt) {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`--${name} must be an integer from ${min} to ${max}`);
  return n;
}

const stampDir = () => path.join(os.tmpdir(), 'konductor-bench', 'cap', new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));
const outDirOf = (opts, repo) => checkScratch(pathOpt(opts.out) ?? stampDir(), repo, '--out');
const logger = (tag) => (m) => console.error(`[${tag} ${new Date().toISOString().slice(11, 19)}] ${m}`);

async function cmdDraft(opts) {
  const { repo, base } = common(opts);
  const ids = list(opts.cap);
  if (!ids.length) throw new Error('--cap is required (for example skill:backend-review, comma separated)');
  const n = intIn(opts.n, 'n', 12, 60, 24);
  const model = opts.model && opts.model !== true ? opts.model : DEFAULT_MODEL;
  const outDir = outDirOf(opts, repo);
  const b = resolveBase(base, repo);
  const log = logger('cap draft');
  let failed = 0;
  let credits = 0;
  try {
    const scan = scanRepo(b.dir);
    for (const id of ids) {
      if (!scan.has(id)) throw new Error(`unknown capability ${id} at ${b.label}`);
      if (id.startsWith('context:')) throw new Error(`${id} cannot be triggered: context files are always loaded`);
    }
    const { caller, cleanup } = makeCapCaller(opts, { rawDir: path.join(outDir, 'model-raw'), log });
    try {
      for (const id of ids) {
        const r = await draftCapability({ capId: id, scan, caller, model, n, outDir });
        credits += r.credits;
        if (r.ok) console.log(`${id}: wrote ${r.file} and ${path.basename(r.mdFile)} (${r.draft.queries.length} queries, attempts ${r.attempts}, ${r.credits.toFixed(3)} credits)`);
        else { failed++; console.log(`${id}: FAILED ${r.error} (attempts ${r.attempts}, ${r.credits.toFixed(3)} credits); nothing written`); }
      }
    } finally { cleanup(); }
  } finally { b.cleanup(); }
  console.log(`model ${model}; ${credits.toFixed(3)} credits in total; drafts are in ${path.join(outDir, 'drafts')}; nothing was written into the repository`);
  process.exitCode = failed ? 1 : 0;
}

function cmdImport(opts) {
  const { repo } = common(opts);
  const capId = opts.cap && opts.cap !== true ? opts.cap : null;
  if (!capId) throw new Error('--cap is required (the capability the queries are for, for example skill:backend-review)');
  if (!ID_RE.test(capId) || capId.startsWith('context:')) throw new Error(`--cap "${capId}" is not a capability id that can be triggered`);
  const from = opts.from && opts.from !== true ? path.resolve(opts.from) : null;
  if (!from) throw new Error('--from FILE is required (a JSON array of { query, should_trigger })');
  let items;
  try { items = JSON.parse(fs.readFileSync(from, 'utf8')); } catch (e) { throw new Error(`cannot read ${from}: ${e.code || e.message}`); }
  const draft = importQueries(items, { capId, source: path.basename(from) });
  const outDir = outDirOf(opts, repo);
  const w = writeDraft(outDir, capId, draft);
  console.log(`${capId}: imported ${draft.queries.length} queries (${draft.queries.filter((q) => q.expect === 'load').length} load, ${draft.queries.filter((q) => q.expect === 'none').length} none) into ${w.file}; review it before use, nothing was written into the repository`);
}

// ---- trigger ----

const RUN_PASSTHROUGH = ['run-credit-limit', 'auth-db', 'model', 'effort', 'kiro-bin', 'cache', 'cargo-target', 'cargo-online', 'isolate', 'agent-engine', 'aws-creds-file', 'aws-profile', 'opencode-bin', 'rg-bin', 'hide'];

// The options of a `run` that executes the trigger tasks of one capability on one arm, stopped at the first capability decision.
function liveRunOpts({ opts, harness, base, tasksDir, taskIds, reps, out, seed, repo, benchDir, extraTasks }) {
  const refName = base === 'main' ? 'origin/main' : base;
  const o = {
    _: [], suite: 'cap', arms: `${harness === 'opencode' ? 'oc-' : ''}base=${refName}`, tasks: taskIds.join(','), replicates: String(reps), parallel: '1', out, seed: String(seed),
    'extra-tasks': [tasksDir, ...extraTasks].join(','), 'bench-dir': benchDir, 'repo-root': repo,
    'stop-on': opts['stop-on'] && opts['stop-on'] !== true ? opts['stop-on'] : 'first-load',
    'max-tool-calls': opts['max-tool-calls'] && opts['max-tool-calls'] !== true ? opts['max-tool-calls'] : '4',
    'censored-floor': opts['censored-floor'] && opts['censored-floor'] !== true ? opts['censored-floor'] : harness === 'opencode' ? '0.5' : '0.5',
  };
  for (const k of RUN_PASSTHROUGH) if (opts[k] !== undefined) o[k] = opts[k];
  if (harness === 'opencode') o['budget-usd'] = opts['budget-usd']; else o['budget-credits'] = opts['budget-credits'];
  return o;
}

async function liveRun({ opts, cap, queries, reps, harness, base, outDir, repo, benchDir, extraTasks, seed, log }) {
  const budgetFlag = harness === 'opencode' ? 'budget-usd' : 'budget-credits';
  if (opts[budgetFlag] === undefined || opts[budgetFlag] === true) throw new Error(`--${budgetFlag} is required for live mode: every query is a real agent run`);
  const slug = cap.id.replace(':', '-');
  const tasksDir = path.join(outDir, 'trigger-tasks', slug);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  const made = trig.materializeTasks({ cap, queries, dir: tasksDir });
  const runOut = path.join(outDir, 'runs', `${slug}-${harness}-live-${Date.now()}`);
  const runOpts = liveRunOpts({ opts, harness, base, tasksDir, taskIds: made.map((m) => m.taskId), reps, out: runOut, seed, repo, benchDir, extraTasks });
  log(`live: ${made.length} trigger task(s) x ${reps} rep(s) in ${tasksDir}; run output ${runOut}`);
  if (opts['dry-run']) {
    console.log(`node bench/runner/bench.js run ${Object.entries(runOpts).filter(([k]) => k !== '_').map(([k, v]) => `--${k} ${/^[\w@%+=:,./-]+$/.test(String(v)) ? v : `'${v}'`}`).join(' ')}`);
    return null;
  }
  await cmdRun(runOpts);
  const run = loadRun(runOut);
  return { runOut, results: run.runs.map((r) => r.result) };
}

function liveScore(results, cap) {
  const { rows, dropped } = trig.liveRows(results, cap);
  const credits = results.reduce((n, r) => n + (r.credits || 0), 0);
  return { rows, dropped, score: scoreTrigger(rows), credits, censored: results.filter((r) => r.creditsCensored).length, first: trig.firstDecisions(results.filter((r) => r.capInvocation)) };
}

async function cmdTrigger(opts) {
  const { repo, benchDir, base, extraTasks } = common(opts);
  const capId = opts.cap && opts.cap !== true ? opts.cap : null;
  if (!capId) throw new Error('--cap is required (for example skill:backend-review)');
  const mode = opts.mode;
  if (mode !== 'proxy' && mode !== 'live') throw new Error('--mode takes proxy or live');
  const harness = opts.harness && opts.harness !== true ? opts.harness : 'kiro-cli';
  if (!['kiro-cli', 'opencode'].includes(harness)) throw new Error('--harness takes kiro-cli or opencode');
  const split = opts.split && opts.split !== true ? opts.split : 'all';
  const reps = intIn(opts.reps, 'reps', 1, 20, 3);
  const crossFraction = opts.crosscheck === undefined ? 0 : Number(opts.crosscheck);
  if (mode === 'live' && (crossFraction > 0 || opts['crosscheck-run'])) throw new Error('--crosscheck applies to proxy mode: it runs live on a sample and compares');
  if (mode === 'proxy') { const ok = proxySupported(capId, harness); if (!ok.ok) throw new Error(ok.reason); }
  const outDir = outDirOf(opts, repo);
  const log = logger('cap trigger');
  const b = resolveBase(base, repo);
  let cap;
  let entry = null;
  let surface = null;
  try {
    const scan = scanRepo(b.dir);
    const c = scan.get(capId);
    if (!c) throw new Error(`unknown capability ${capId} at ${b.label}`);
    if (c.kind === 'context') throw new Error(`${capId} cannot be triggered: context files are always loaded`);
    cap = { id: c.id, kind: c.kind, name: c.name };
    entry = loadRegistry(benchDir).entries.find((e) => e.data?.id === capId)?.data ?? null;
    const queries = opts.queries && opts.queries !== true ? trig.queriesFromDraft(path.resolve(opts.queries), capId) : trig.queriesFromRegistry(entry ?? { id: capId, trigger: { queries: [] } }, split);
    const fromRun = opts['from-run'] && opts['from-run'] !== true ? path.resolve(opts['from-run']) : null;
    const fromArm = opts['from-arm'] && opts['from-arm'] !== true ? opts['from-arm'] : null;
    const acting = opts['acting-agent'] && opts['acting-agent'] !== true ? opts['acting-agent'] : entry?.expect?.['kiro-cli']?.actingAgents?.[0] ?? 'konductor';
    const seed = opts.seed === undefined ? seedOf(`${capId}:trigger`) : Number(opts.seed);
    const model = opts.model && opts.model !== true ? opts.model : DEFAULT_MODEL;
    const splitLabel = opts.queries ? 'draft (no splits)' : split;
    const write = (name, report, json) => {
      fs.writeFileSync(path.join(outDir, `${name}.md`), report);
      fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
      return path.join(outDir, `${name}.md`);
    };
    const nameOf = `trigger-${capId.replace(':', '-')}-${harness}-${mode}`;

    if (mode === 'live') {
      const live = await liveRun({ opts, cap, queries, reps, harness, base, outDir, repo, benchDir, extraTasks, seed, log });
      if (!live) return;
      const s = liveScore(live.results, cap);
      const report = trig.renderTriggerReport({ cap, harness, mode, split: splitLabel, reps, score: s.score, credits: s.credits, censored: s.censored, firstDecisions: s.first, model: live.results[0]?.model ?? null });
      const file = write(nameOf, report, { cap, harness, mode, split: splitLabel, reps, base, score: s.score, rows: s.rows, dropped: s.dropped, credits: s.credits, censored: s.censored, firstDecisions: s.first, runDir: live.runOut });
      console.log(opts.json ? JSON.stringify({ score: s.score, rows: s.rows }, null, 2) : report);
      console.log(`wrote ${file}`);
      return;
    }

    surface = harness === 'opencode'
      ? opencodeSurface({ baseDir: b.dir, fromRun, armName: fromArm })
      : kiroSurface({ baseDir: b.dir, actingAgent: acting, fromRun, armName: fromArm });
    if (surface.missing?.length) log(`warning: the filter lists ${surface.missing.length} name(s) with no file in the tree: ${surface.missing.join(', ')}`);
    const { caller, cleanup } = makeCapCaller(opts, { rawDir: path.join(outDir, 'model-raw'), log });
    let proxy;
    try {
      proxy = await runProxy({
        harness, capName: cap.name, queries, reps, surface, caller, model, log,
        concurrency: intIn(opts.concurrency, 'concurrency', 1, 8, 3), budgetCredits: opts['budget-credits'] === undefined ? null : Number(opts['budget-credits']),
      });
    } finally { cleanup(); }
    const score = scoreTrigger(proxy.rows);
    const summary = summarizeProxy(proxy.rows);

    // The cross-check: live results for a sample, or for a finished live run, against the proxy's predictions.
    let cross = null;
    let liveCredits = 0;
    let liveResults = null;
    if (opts['crosscheck-run'] && opts['crosscheck-run'] !== true) {
      liveResults = loadRun(path.resolve(opts['crosscheck-run'])).runs.map((r) => r.result);
    } else if (crossFraction > 0) {
      const sample = trig.crossCheckSample(queries, crossFraction, seed);
      log(`cross-check: ${sample.length} of ${queries.length} queries run live`);
      const live = await liveRun({ opts, cap, queries: sample, reps, harness, base, outDir, repo, benchDir, extraTasks, seed, log });
      liveResults = live ? live.results : null;
    }
    if (liveResults) {
      const ls = liveScore(liveResults, cap);
      liveCredits = ls.credits;
      cross = crossCheck(trig.crossPairs(score, ls.score));
    }
    const report = trig.renderTriggerReport({
      cap, harness, mode, split: splitLabel, reps, score, proxy: summary, credits: proxy.spent, calls: proxy.calls.length, label: cross ? cross.label : null, model, surface: surface.source,
      crossCheck: cross, skipped: proxy.skipped.length,
    });
    const perCall = proxy.calls.length ? proxy.spent / proxy.calls.length : 0;
    const file = write(nameOf, report, { cap, harness, mode, split: splitLabel, reps, base, model, surface: { source: surface.source, actingAgent: surface.actingAgent ?? null, filter: surface.skillFilter ?? null }, score, summary, rows: proxy.rows, skipped: proxy.skipped, credits: proxy.spent, liveCredits, calls: proxy.calls.length, creditsPerCall: perCall, crossCheck: cross });
    console.log(opts.json ? JSON.stringify({ score, summary, crossCheck: cross }, null, 2) : report);
    console.log(`wrote ${file} (${perCall.toFixed(3)} credits per model call)`);
  } finally { b.cleanup(); }
}

function cmdCap(opts) {
  const sub = opts._[0];
  if (!SUBCOMMANDS.includes(sub)) { console.error(`bench: cap takes ${SUBCOMMANDS.join(', ')}`); process.exitCode = 2; return; }
  const run = () => {
    if (sub === 'list') return cmdList(opts);
    if (sub === 'audit') return cmdAudit(opts);
    if (sub === 'variant') return cmdVariant(opts);
    if (sub === 'plan') return cmdPlan(opts);
    if (sub === 'draft') return cmdDraft(opts);
    if (sub === 'import') return cmdImport(opts);
    return cmdTrigger(opts);
  };
  const fail = (e) => {
    console.error(`cap ${sub}: ${e.message}`);
    process.exitCode = e.constructor.name === 'InstallsChanged' ? 1 : 2;
  };
  try {
    const out = run();
    if (out && typeof out.then === 'function') return out.catch(fail);
  } catch (e) { fail(e); }
  return undefined;
}

module.exports = { cmdCap, SUBCOMMANDS };
