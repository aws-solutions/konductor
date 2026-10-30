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
const { buildVariant, verifyInstalled, reachWarning, checkScratch } = require('./variant.js');
const { planCap } = require('./plan.js');
const { guardInstalls } = require('./guard.js');
const { EXPECTED_TOOL } = require('./registry.js');

const SUBCOMMANDS = ['list', 'audit', 'variant', 'plan'];
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
    id: c.id, kind: c.kind, path: c.path, owner: '',
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
    const rows = [['id', 'registered', 'owner', 'kiro agents', 'tasks', 'queries', 'gap']];
    for (const c of caps) {
      rows.push([c.id, c.registered ? 'yes' : '-', c.owner ?? '-', c.reach.kiro ? c.reach.kiro.agents.length : '-', c.tasks.linked.length + c.tasks.byTarget.length, c.registered ? c.triggerQueries : '-', c.tasks.gap ?? '-']);
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

function cmdCap(opts) {
  const sub = opts._[0];
  if (!SUBCOMMANDS.includes(sub)) { console.error(`bench: cap takes ${SUBCOMMANDS.join(', ')}`); process.exitCode = 2; return; }
  try {
    if (sub === 'list') cmdList(opts);
    else if (sub === 'audit') cmdAudit(opts);
    else if (sub === 'variant') cmdVariant(opts);
    else cmdPlan(opts);
  } catch (e) {
    console.error(`cap ${sub}: ${e.message}`);
    process.exitCode = e.constructor.name === 'InstallsChanged' ? 1 : 2;
  }
}

module.exports = { cmdCap, SUBCOMMANDS };
