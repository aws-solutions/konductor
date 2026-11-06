#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Planning, arm building and the driver for the constraints probe study (bench/CONSTRAINTS-PROBE.md).
// Nothing here calls a model. `build-arms` extracts a pinned commit twice under a scratch directory (never into the
// repository) and `driver` writes the shell script that runs the groups one after another.
//
//   node bench/scripts/probe-study.js plan [--base DIR] [--repo DIR] [--replicates N] [--arms a,b] [--only-agent A] [--json]
//   node bench/scripts/probe-study.js build-arms [--base DIR] [--repo DIR] [--sha SHA]
//   node bench/scripts/probe-study.js driver [--base DIR] [--repo DIR]
//   node bench/scripts/probe-study.js groups [--base DIR] ...     (one TSV line per group, read by the driver)
//   node bench/scripts/probe-study.js status [--base DIR]         (read only)
//   node bench/scripts/probe-study.js spent --runs DIR            (credits charged under a runs directory)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { forcedPrefix } = require('../cap/forced.js');
const { tryMark } = require('../runner/lib/owned.js');

const BENCH = path.resolve(__dirname, '..');
const REPO = path.resolve(BENCH, '..');
const MANIFEST = path.join(BENCH, 'suites', 'constraints-probe.manifest.json');
const DEFAULT_BASE = '/var/tmp/constraints-probe';
const PINNED_SHA = 'ed3a5968143b5e1bbb6a98ea462a5d73bcb6501c';
const ARM_ORDER = ['k-main', 'k-main-forced', 'k-none', 'k-canary', 'k-canary-forced'];
const RUN_FLAGS = { engine: 'v3', model: 'claude-sonnet-5.5', parallel: 1, seed: 1, runCreditLimit: 8 };
const CACHE = '/var/tmp/pilot-2x2/cache';
const CARGO_TARGET = '/var/tmp/pilot-2x2/cargo-target';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const redact = (token) => `${String(token).slice(0, 8)}...`;
const git = (repo, args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts }).trim();

// ---- plan ----

function perRunCredits(manifest, kind, entry) {
  const est = manifest.creditEstimate.perRun;
  if (kind === 'canary') return entry === 'konductor' ? est['canary-konductor'] : est.canary;
  return est[entry] ?? est.konductor;
}

/**
 * Groups of one `bench.js run` each: one arm, one entry agent. Run counts are tasks x replicates; credit figures use the
 * per-run estimate of the manifest with its low and high factors; the budget leaves headroom over the mid estimate.
 */
function plan({ manifest = loadManifest(), replicates = 5, arms = ARM_ORDER, onlyAgent = null, onlyArm = null } = {}) {
  const est = manifest.creditEstimate;
  const groups = [];
  for (const arm of ARM_ORDER.filter((a) => arms.includes(a))) {
    if (onlyArm && arm !== onlyArm) continue;
    const def = manifest.arms[arm];
    if (!def) throw new Error(`unknown arm ${arm}`);
    for (const g of manifest.groups) {
      if (onlyAgent && g.entry !== onlyAgent) continue;
      const tasks = def.kind === 'canary' ? g.canary : g.u;
      if (!tasks.length) continue;
      const each = perRunCredits(manifest, def.kind, g.entry);
      const runs = tasks.length * replicates;
      const mid = runs * each;
      groups.push({
        arm, entry: g.entry, position: g.position, kind: def.kind, forced: def.forced, tasks, runs, creditsMid: mid, creditsLow: mid * est.lowFactor,
        creditsHigh: mid * est.highFactor, budget: Math.max(5, Math.ceil(mid * est.budgetFactor)),
      });
    }
  }
  const sum = (f) => groups.reduce((n, g) => n + f(g), 0);
  const budgets = sum((g) => g.budget);
  return {
    replicates, groups, runs: sum((g) => g.runs), creditsLow: sum((g) => g.creditsLow), creditsMid: sum((g) => g.creditsMid), creditsHigh: sum((g) => g.creditsHigh),
    budgetSum: budgets, cap: Math.ceil(budgets / 10) * 10,
  };
}

const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

function formatPlan(p, { arms, base, repo, refusal } = {}) {
  const L = [];
  L.push(`constraints-probe plan: ${p.groups.length} groups, ${p.runs} runs, ${p.replicates} replicates, one run at a time`);
  if (arms) {
    L.push('', 'Arms:');
    for (const [name, a] of Object.entries(arms.arms)) L.push(`  ${name.padEnd(16)} ${a.spec}${a.prefix ? `  prefix sha256 ${arms.prefix.sha256.slice(0, 12)}` : ''}`);
    L.push(`  pinned commit    ${arms.sha}${arms.originMainMoved ? `  (origin/main has moved to ${arms.originMain}; kept for comparability)` : ''}`);
    L.push(`  canary token     ${redact(arms.canary.token)} (sha256 ${arms.canary.sha256.slice(0, 12)}); the full token is in ${path.join(base ?? DEFAULT_BASE, 'arms.json')} only`);
    L.push(`  forced prefix    ${arms.prefix.text}`);
  }
  L.push('', `${'group'.padEnd(34)} ${'position'.padEnd(10)} ${'tasks'.padStart(5)} ${'runs'.padStart(5)} ${'low'.padStart(7)} ${'mid'.padStart(7)} ${'high'.padStart(7)} ${'budget'.padStart(7)}`);
  for (const g of p.groups) L.push(`${`${g.arm} / ${g.entry}`.padEnd(34)} ${g.position.padEnd(10)} ${String(g.tasks.length).padStart(5)} ${String(g.runs).padStart(5)} ${f1(g.creditsLow).padStart(7)} ${f1(g.creditsMid).padStart(7)} ${f1(g.creditsHigh).padStart(7)} ${String(g.budget).padStart(7)}`);
  L.push(`${'TOTAL'.padEnd(34)} ${''.padEnd(10)} ${''.padStart(5)} ${String(p.runs).padStart(5)} ${f1(p.creditsLow).padStart(7)} ${f1(p.creditsMid).padStart(7)} ${f1(p.creditsHigh).padStart(7)} ${String(p.budgetSum).padStart(7)}`);
  L.push('', `Credit cap for the whole study: ${p.cap} (sum of the group budgets rounded up to 10). The driver starts no group once the charged total reaches it.`, `Per run: --run-credit-limit ${RUN_FLAGS.runCreditLimit}. Estimates are credits per run from earlier runs on this model, with the factors in the manifest; they are not measured for these tasks.`);
  if (repo) L.push(`Repository for bench.js: ${repo}`);
  if (refusal !== undefined) L.push('', refusal ? `A real start would refuse now: ${refusal}` : 'A real start would not be refused by another bench process or the root-cause driver.');
  return L.join('\n');
}

// ---- arms ----

function writeFile(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }

function extract(repo, sha, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', sha], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar });
}

/** The canary line is appended to the end of the skill, on its own marked line. */
function canaryLine(token) { return `\nCANARY TOKEN (delivery check; repeat it if asked): ${token}\n`; }

/** Same tree with no skill or SOP names in any agent spec, so the installer injects no skills server. */
function stripSkills(dir) {
  const agents = path.join(dir, 'agents');
  const changed = [];
  for (const f of fs.readdirSync(agents).filter((n) => n.endsWith('.agent-spec.json'))) {
    const file = path.join(agents, f);
    const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
    spec.dependencies = spec.dependencies || {};
    spec.dependencies.skills = { ...(spec.dependencies.skills || {}), skillNames: [] };
    spec.dependencies.agentSops = { ...(spec.dependencies.agentSops || {}), agentSopNames: [] };
    fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
    changed.push(f);
  }
  return changed;
}

function buildArms({ base = DEFAULT_BASE, repo = REPO, sha = PINNED_SHA, log = () => {} } = {}) {
  const file = path.join(base, 'arms.json');
  const previous = readJson(file);
  const full = git(repo, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (full !== sha) throw new Error(`--sha must be the full commit id (${full})`);
  let originMain = null;
  try { originMain = git(repo, ['rev-parse', 'origin/main']); } catch { /* no origin/main in this checkout */ }
  // The token is made once. A rebuild keeps it, so the arm's content hash and the build cache stay valid on resume.
  const token = previous?.sha === sha && previous?.canary?.token ? previous.canary.token : `kd-canary-${crypto.randomBytes(4).toString('hex')}`;
  const canarySrc = path.join(base, 'canary-src');
  const noneSrc = path.join(base, 'none-src');
  extract(repo, sha, canarySrc);
  const skill = path.join(canarySrc, 'skills', 'constraints', 'SKILL.md');
  if (!fs.existsSync(skill)) throw new Error(`${skill} not found in ${sha}`);
  fs.appendFileSync(skill, canaryLine(token));
  extract(repo, sha, noneSrc);
  const stripped = stripSkills(noneSrc);
  log(`canary tree: ${canarySrc}; none tree: ${noneSrc} (${stripped.length} agent specs without skill or SOP names)`);

  const prefixText = forcedPrefix({ name: 'constraints', harness: 'kiro-cli' });
  const prefixFile = path.join(base, 'prefix', 'constraints-kiro-cli.txt');
  writeFile(prefixFile, prefixText + '\n');
  const manifest = loadManifest();
  const spec = {
    'k-main': `k-main=${sha}`, 'k-main-forced': `k-main-forced=${sha}`, 'k-none': `k-none=dir:${noneSrc}`,
    'k-canary': `k-canary=dir:${canarySrc}`, 'k-canary-forced': `k-canary-forced=dir:${canarySrc}`,
  };
  const arms = {};
  for (const name of ARM_ORDER) arms[name] = { spec: spec[name], kind: manifest.arms[name].kind, forced: manifest.arms[name].forced, prefix: manifest.arms[name].forced };
  const record = {
    schemaVersion: 1, builtAt: new Date().toISOString(), sha, originMain, originMainMoved: Boolean(originMain && originMain !== sha),
    canary: { token, sha256: sha256(token), file: skill, line: canaryLine(token).trim().replace(token, '<token>') },
    prefix: { file: prefixFile, text: prefixText, sha256: sha256(prefixText + '\n') },
    none: { dir: noneSrc, agentSpecsChanged: stripped.length, note: 'skillNames and agentSopNames emptied in every agent spec; installer then adds no skills server. Not verified until a --prepare-only build.' },
    arms,
  };
  writeFile(file, JSON.stringify(record, null, 2) + '\n');
  fs.chmodSync(file, 0o600);
  return record;
}

// ---- driver ----

function armsRecord(base) {
  const rec = readJson(path.join(base, 'arms.json'));
  if (!rec) throw new Error(`${path.join(base, 'arms.json')} not found; run: node bench/scripts/probe-study.js build-arms --base ${base}`);
  return rec;
}

/** Why a real start must not happen now, or null. `procs` is the process list text; `rootcausePidFile` the other driver's pid file. */
function refusalReason({ procs, rootcausePidFile, ownPidFile, isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } }) {
  const bench = String(procs ?? '').split('\n').filter((l) => /bench\/runner\/bench\.js/.test(l) && !/probe-study\.js|probe-report|\bgrep\b/.test(l));
  if (bench.length) return `another bench process is running: ${bench[0].trim().slice(0, 120)}`;
  if (/rootcause\/run-all\.sh/.test(String(procs ?? ''))) return 'the root-cause driver is running';
  const alive = (f) => { const pid = Number(String(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').trim()); return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null; };
  const rc = rootcausePidFile ? alive(rootcausePidFile) : null;
  if (rc) return `the root-cause run is alive (pid ${rc})`;
  const own = ownPidFile ? alive(ownPidFile) : null;
  if (own && own !== process.pid) return `this study is already running (pid ${own})`;
  return null;
}

function renderDriver({ base = DEFAULT_BASE, repo = REPO } = {}) {
  const study = path.join(repo, 'bench', 'scripts', 'probe-study.js');
  return `#!/usr/bin/env bash
# Constraints probe study driver. Generated by: node bench/scripts/probe-study.js driver
# One \`bench.js run\` per (arm, entry agent) group, groups one after another. Kiro only, no AWS keys.
# Re-running resumes at group level: a group with a .done marker is skipped; an interrupted group is moved to
# <group>.partial-<time> (kept, not deleted) and run again from the start, because \`bench.js run --out\` has no run-level resume.
#
#   bash run-all.sh --dry-run     print the plan and the exact commands; changes nothing
#   bash run-all.sh               real start (refuses while another bench process or the root-cause driver runs)
#
# Test hooks: PROBE_REPLICATES, PROBE_ARMS=a,b, PROBE_ONLY_ARM, PROBE_ONLY_AGENT, PROBE_PREPARE_ONLY=1 (builds and trial-installs, spends nothing),
# PROBE_PROC_LIST=FILE (process list to check instead of ps), PROBE_ROOTCAUSE_PID=FILE, PROBE_BASE=DIR, PROBE_REPO=DIR,
# PROBE_AUTH_DB=FILE, PROBE_CACHE=DIR, PROBE_CARGO_TARGET=DIR.
set -u
BASE=\${PROBE_BASE:-${base}}
REPO=\${PROBE_REPO:-${repo}}
STUDY=\$REPO/bench/scripts/probe-study.js
ROOTCAUSE_PID=\${PROBE_ROOTCAUSE_PID:-/var/tmp/rootcause/run.pid}
AUTH_DB=\${PROBE_AUTH_DB:-\$HOME/.local/share/kiro-cli/data.sqlite3}
OUTBASE=\$BASE/runs
MARK=\$BASE/markers
export TMPDIR=\$BASE/tmp
for v in \$(env | grep -o '^AWS_[A-Za-z_]*'); do unset "\$v"; done

log() { echo "[driver \$(date -u +%FT%TZ)] \$*"; }
plan_args=(--base "\$BASE" --repo "\$REPO")
[ -n "\${PROBE_REPLICATES:-}" ] && plan_args+=(--replicates "\$PROBE_REPLICATES")
[ -n "\${PROBE_ARMS:-}" ] && plan_args+=(--arms "\$PROBE_ARMS")
[ -n "\${PROBE_ONLY_ARM:-}" ] && plan_args+=(--only-arm "\$PROBE_ONLY_ARM")
[ -n "\${PROBE_ONLY_AGENT:-}" ] && plan_args+=(--only-agent "\$PROBE_ONLY_AGENT")

busy() {
  if [ -n "\${PROBE_PROC_LIST:-}" ]; then procs=\$(cat "\$PROBE_PROC_LIST"); else procs=\$(ps -eo args 2>/dev/null); fi
  printf '%s\\n' "\$procs" | node "\$STUDY" refusal --rootcause-pid "\$ROOTCAUSE_PID" --own-pid "\$BASE/run.pid"
}

if [ "\${1:-}" = "--dry-run" ]; then
  node "\$STUDY" plan "\${plan_args[@]}" --commands --refusal "\$(busy)"
  exit \$?
fi

reason=\$(busy)
if [ -n "\$reason" ]; then log "REFUSING to start: \$reason"; exit 3; fi

mkdir -p "\$OUTBASE" "\$MARK" "\$TMPDIR"
echo \$\$ > "\$BASE/run.pid"
trap 'rm -f "\$BASE/run.pid"' EXIT
cd "\$REPO" || exit 1
node "\$STUDY" build-arms --base "\$BASE" --repo "\$REPO" || exit 1
CAP=\$(node "\$STUDY" plan "\${plan_args[@]}" --print-cap)
log "STUDY START cap=\$CAP credits; arms from \$BASE/arms.json (canary token \$(node "\$STUDY" token --base "\$BASE"))"

node "\$STUDY" groups "\${plan_args[@]}" | while IFS='|' read -r arm agent tasks budget runs armspec prefixflag agentflag; do
  name="\${arm}__\${agent}"
  out=\$OUTBASE/\$arm/\$agent
  if [ -e "\$MARK/\$name.done" ] && [ -z "\${PROBE_PREPARE_ONLY:-}" ]; then log "GROUP \$name already done, skipping"; continue; fi
  spent=\$(node "\$STUDY" spent --runs "\$OUTBASE")
  if [ -z "\${PROBE_PREPARE_ONLY:-}" ] && node -e 'process.exit(Number(process.argv[1]) >= Number(process.argv[2]) ? 0 : 1)' "\$spent" "\$CAP"; then
    log "STOP: charged \$spent reached the study cap \$CAP"; exit 4
  fi
  if [ -e "\$out" ] && [ -z "\${PROBE_PREPARE_ONLY:-}" ]; then
    aside=\$out.partial-\$(date -u +%Y%m%dT%H%M%SZ)
    log "GROUP \$name has an unfinished run dir; moving it to \$aside"
    mv "\$out" "\$aside"
  fi
  prefix_args=(); [ -n "\$prefixflag" ] && prefix_args=(--arm-prefix "\$prefixflag")
  agent_args=(); [ -n "\$agentflag" ] && agent_args=(--arm-agent "\$agentflag")
  prep_args=(); [ -n "\${PROBE_PREPARE_ONLY:-}" ] && prep_args=(--prepare-only)
  log "GROUP START \$name tasks=\$tasks runs=\$runs budget=\$budget"
  [ -z "\${PROBE_PREPARE_ONLY:-}" ] && date -u +%FT%TZ > "\$MARK/\$name.started"
  nice -n 10 node bench/runner/bench.js run --suite constraints-probe --tasks "\$tasks" \\
    --arms "\$armspec" "\${prefix_args[@]}" "\${agent_args[@]}" \\
    --agent-engine ${RUN_FLAGS.engine} --model ${RUN_FLAGS.model} --replicates "\${PROBE_REPLICATES:-5}" --parallel ${RUN_FLAGS.parallel} --seed ${RUN_FLAGS.seed} \\
    --budget-credits "\$budget" --run-credit-limit ${RUN_FLAGS.runCreditLimit} \\
    --repo-root "\$REPO" \\
    --cache "\${PROBE_CACHE:-${CACHE}}" --cargo-target "\${PROBE_CARGO_TARGET:-${CARGO_TARGET}}" \\
    --auth-db "\$AUTH_DB" "\${prep_args[@]}" \\
    --out "\$out" < /dev/null
  rc=\$?
  log "GROUP END \$name exit=\$rc"
  [ -n "\${PROBE_PREPARE_ONLY:-}" ] && continue
  case \$rc in
    0) date -u +%FT%TZ > "\$MARK/\$name.done" ;;
    3) date -u +%FT%TZ > "\$MARK/\$name.done"; echo "credit guard hard stop" > "\$MARK/\$name.budget-stop" ;;
    *) echo "exit \$rc" > "\$MARK/\$name.failed"; log "stopping: group \$name failed with exit \$rc"; exit "\$rc" ;;
  esac
done
rc=\$?
[ \$rc -eq 0 ] && log "ALL GROUPS FINISHED"
exit \$rc
`;
}

function renderStatusScript({ base = DEFAULT_BASE, repo = REPO } = {}) {
  return `#!/usr/bin/env bash
# Read-only status of the constraints probe study. Calls no AWS, kiro-cli, claude or opencode.
exec node "\${PROBE_REPO:-${repo}}/bench/scripts/probe-study.js" status --base "\${PROBE_BASE:-${base}}"
`;
}

function groupCommandLine(g, arms) {
  const a = arms.arms[g.arm];
  const prefix = a.prefix ? `${g.arm}=${arms.prefix.file}` : '';
  const agent = g.entry === 'konductor' ? '' : `${g.arm}=${g.entry}`;
  return { prefix, agent, spec: a.spec };
}

function spentUnder(dir) {
  let total = 0;
  const walk = (d, depth) => {
    if (depth > 4 || !fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1); else if (e.name === 'credit-ledger.jsonl') {
        for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
          try { const r = JSON.parse(line); if (r.kind === 'run') total += r.charged ?? r.credits ?? 0; } catch { /* torn line */ }
        }
      }
    }
  };
  walk(dir, 0);
  return total;
}

function status(base) {
  const L = [];
  const pidFile = path.join(base, 'run.pid');
  const pid = Number(String(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : '').trim());
  let alive = false;
  if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
  L.push(`process: ${alive ? `ALIVE pid=${pid}` : `NOT RUNNING (pid=${pid || 'none'})`}`);
  const markers = fs.existsSync(path.join(base, 'markers')) ? fs.readdirSync(path.join(base, 'markers')).sort() : [];
  L.push('', `markers: ${markers.join(' ') || 'none'}`, '', 'per group: runs found, credits charged');
  const runs = path.join(base, 'runs');
  if (fs.existsSync(runs)) {
    for (const arm of fs.readdirSync(runs).sort()) {
      for (const agent of fs.readdirSync(path.join(runs, arm)).sort()) {
        const dir = path.join(runs, arm, agent);
        if (!fs.statSync(dir).isDirectory()) continue;
        let n = 0;
        const walk = (d, depth) => { if (depth > 6) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory() && !['workspace', 'session'].includes(e.name)) walk(path.join(d, e.name), depth + 1); else if (e.name === 'result.json') n++; } };
        walk(dir, 0);
        L.push(`  ${`${arm} / ${agent}`.padEnd(34)} runs=${String(n).padStart(3)} credits=${f1(spentUnder(dir)).padStart(7)}`);
      }
    }
  }
  L.push('', `TOTAL charged: ${f1(spentUnder(runs))}`);
  const log = path.join(base, 'run.log');
  if (fs.existsSync(log)) L.push('', 'last log lines:', ...fs.readFileSync(log, 'utf8').trim().split('\n').slice(-8).map((l) => '  ' + l.slice(0, 200)));
  return L.join('\n');
}

// ---- cli ----

function argv(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const k = args[i].slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) o[k] = true; else { o[k] = next; i++; }
  }
  return o;
}

function planFromArgs(o) {
  const record = o.arms && o.arms !== true ? String(o.arms).split(',') : ARM_ORDER;
  return plan({
    replicates: o.replicates ? Number(o.replicates) : 5, arms: record, onlyAgent: o['only-agent'] && o['only-agent'] !== true ? o['only-agent'] : null,
    onlyArm: o['only-arm'] && o['only-arm'] !== true ? o['only-arm'] : null,
  });
}

function main(args) {
  const [cmd, ...rest] = args;
  const o = argv(rest);
  const base = o.base && o.base !== true ? path.resolve(o.base) : DEFAULT_BASE;
  const repo = o.repo && o.repo !== true ? path.resolve(o.repo) : REPO;
  if (cmd === 'plan') {
    const p = planFromArgs(o);
    if (o['print-cap']) { console.log(p.cap); return; }
    if (o.json) { console.log(JSON.stringify(p, null, 2)); return; }
    const arms = fs.existsSync(path.join(base, 'arms.json')) ? armsRecord(base) : null;
    console.log(formatPlan(p, { arms, base, repo, refusal: o.refusal === undefined ? undefined : (o.refusal === true ? '' : o.refusal) }));
    if (o.commands && arms) {
      console.log('\nExact commands (one per group, run in order from the repository root):');
      for (const g of p.groups) {
        const c = groupCommandLine(g, arms);
        console.log(`  nice -n 10 node bench/runner/bench.js run --suite constraints-probe --tasks ${g.tasks.join(',')} --arms ${c.spec}${c.prefix ? ` --arm-prefix ${c.prefix}` : ''}${c.agent ? ` --arm-agent ${c.agent}` : ''} --agent-engine ${RUN_FLAGS.engine} --model ${RUN_FLAGS.model} --replicates ${p.replicates} --parallel ${RUN_FLAGS.parallel} --seed ${RUN_FLAGS.seed} --budget-credits ${g.budget} --run-credit-limit ${RUN_FLAGS.runCreditLimit} --repo-root ${repo} --cache ${CACHE} --cargo-target ${CARGO_TARGET} --out ${path.join(base, 'runs', g.arm, g.entry)}`);
      }
    }
    return;
  }
  if (cmd === 'groups') {
    const p = planFromArgs(o);
    const arms = armsRecord(base);
    for (const g of p.groups) {
      const c = groupCommandLine(g, arms);
      console.log([g.arm, g.entry, g.tasks.join(','), g.budget, g.runs, c.spec, c.prefix, c.agent].join('|'));
    }
    return;
  }
  if (cmd === 'build-arms') {
    const rec = buildArms({ base, repo, sha: o.sha && o.sha !== true ? o.sha : PINNED_SHA, log: (m) => console.error(m) });
    console.log(`arms built at ${base}/arms.json; commit ${rec.sha}; canary token ${redact(rec.canary.token)} (sha256 ${rec.canary.sha256.slice(0, 12)})${rec.originMainMoved ? `; origin/main is now ${rec.originMain}` : ''}`);
    return;
  }
  if (cmd === 'token') { const rec = armsRecord(base); console.log(rec.canary.token); return; }
  if (cmd === 'driver') {
    const baseExisted = fs.existsSync(base);
    writeFile(path.join(base, 'run-all.sh'), renderDriver({ base, repo }));
    writeFile(path.join(base, 'status.sh'), renderStatusScript({ base, repo }));
    fs.chmodSync(path.join(base, 'run-all.sh'), 0o755);
    fs.chmodSync(path.join(base, 'status.sh'), 0o755);
    if (!baseExisted) tryMark(base, 'study-driver-dir', { id: path.basename(base) });
    console.log(`wrote ${path.join(base, 'run-all.sh')} and ${path.join(base, 'status.sh')}`);
    return;
  }
  if (cmd === 'refusal') {
    const procs = fs.readFileSync(0, 'utf8');
    const why = refusalReason({ procs, rootcausePidFile: o['rootcause-pid'] && o['rootcause-pid'] !== true ? o['rootcause-pid'] : null, ownPidFile: o['own-pid'] && o['own-pid'] !== true ? o['own-pid'] : null });
    if (why) console.log(why);
    return;
  }
  if (cmd === 'status') { console.log(status(base)); return; }
  if (cmd === 'spent') { console.log(spentUnder(path.resolve(o.runs && o.runs !== true ? o.runs : path.join(base, 'runs'))).toFixed(2)); return; }
  console.error('usage: probe-study.js plan|groups|build-arms|token|driver|refusal|status|spent [flags]');
  process.exitCode = 2;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`probe-study: ${e.message}`); process.exitCode = 2; }
}

module.exports = { plan, formatPlan, buildArms, stripSkills, canaryLine, refusalReason, renderDriver, renderStatusScript, groupCommandLine, spentUnder, status, redact, ARM_ORDER, PINNED_SHA, DEFAULT_BASE, RUN_FLAGS };
