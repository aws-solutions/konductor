#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Planning, arm checks and the driver for the references-read study (bench/REFERENCES-READ.md).
// Nothing here calls a model. `build-arms` checks the pinned commits and writes the forced-load prefix files under a
// scratch directory (never into the repository), and `driver` writes the shell script that runs the groups one after another.
//
//   node bench/scripts/refs-study.js plan [--base DIR] [--repo DIR] [--replicates N] [--arms a,b] [--only-arm A] [--json] [--commands] [--refusal TEXT]
//   node bench/scripts/refs-study.js build-arms [--base DIR] [--repo DIR] [--freeze]
//   node bench/scripts/refs-study.js driver [--base DIR] [--repo DIR]
//   node bench/scripts/refs-study.js groups [--base DIR] ...      (one line per group, read by the driver)
//   node bench/scripts/refs-study.js refusal [--rootcause-pid FILE] [--own-pid FILE]   (process list on stdin; prints the reason or nothing)
//   node bench/scripts/refs-study.js status [--base DIR]          (read only)
//   node bench/scripts/refs-study.js spent --runs DIR             (credits charged under a runs directory)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { forcedPrefix } = require('../cap/forced.js');
const { tryMark } = require('../runner/lib/owned.js');

const BENCH = path.resolve(__dirname, '..');
const REPO = path.resolve(BENCH, '..');
const MANIFEST = path.join(BENCH, 'suites', 'references-read.manifest.json');
const DEFAULT_BASE = '/var/tmp/refs-read';
const RUN_FLAGS = { engine: 'v3', model: 'claude-sonnet-5.5', parallel: 1, seed: 1, runCreditLimit: 8 };
const CACHE = '/var/tmp/pilot-2x2/cache';
const CARGO_TARGET = '/var/tmp/pilot-2x2/cargo-target';
const REPLICATES = 3;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const git = (repo, args, opts = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, ...opts }).trim();
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

// ---- plan ----

/**
 * Groups of one `bench.js run` each: one arm, one entry agent. Run counts are tasks x replicates; credit figures use the
 * per-run estimate of the manifest with its low and high factors; the budget leaves headroom over the mid estimate.
 */
function plan({ manifest = loadManifest(), replicates = REPLICATES, arms = null, onlyArm = null } = {}) {
  const est = manifest.creditEstimate;
  const groups = [];
  for (const g of manifest.groups) {
    if (arms && !arms.includes(g.arm)) continue;
    if (onlyArm && g.arm !== onlyArm) continue;
    const def = manifest.arms[g.arm];
    if (!def) throw new Error(`unknown arm ${g.arm}`);
    const each = est.perRun[g.entry];
    if (each == null) throw new Error(`no credit estimate for entry agent ${g.entry}`);
    const runs = g.tasks.length * replicates;
    const mid = runs * each;
    groups.push({
      arm: g.arm, entry: g.entry, role: def.role, forced: def.forced, ref: def.ref, tasks: g.tasks, prefixSkill: g.prefixSkill, runs,
      creditsMid: mid, creditsLow: mid * est.lowFactor, creditsHigh: mid * est.highFactor, budget: Math.max(5, Math.ceil(mid * est.budgetFactor)),
    });
  }
  const sum = (f) => groups.reduce((n, g) => n + f(g), 0);
  const budgets = sum((g) => g.budget);
  return {
    replicates, groups, runs: sum((g) => g.runs), creditsLow: sum((g) => g.creditsLow), creditsMid: sum((g) => g.creditsMid), creditsHigh: sum((g) => g.creditsHigh),
    budgetSum: budgets, cap: Math.ceil(budgets / 10) * 10,
  };
}

function formatPlan(p, { arms, base, repo, refusal } = {}) {
  const L = [];
  L.push(`references-read plan: ${p.groups.length} groups, ${p.runs} runs, ${p.replicates} replicates, one run at a time`);
  if (arms) {
    L.push('', 'Arms:');
    for (const [name, a] of Object.entries(arms.arms)) L.push(`  ${name.padEnd(18)} ${a.spec}${a.forced ? '  (forced load, prefix per group)' : ''}`);
    for (const [k, r] of Object.entries(arms.refs)) L.push(`  ${`ref ${k}`.padEnd(18)} ${r.sha}${r.onRemote ? '' : '  (not on any remote branch; the runner builds it from this checkout)'}`);
    for (const [skill, pf] of Object.entries(arms.prefixes)) L.push(`  prefix ${skill.padEnd(11)} sha256 ${pf.sha256.slice(0, 12)}  "${pf.text}"`);
  }
  L.push('', `${'group'.padEnd(40)} ${'role'.padEnd(10)} ${'tasks'.padStart(5)} ${'runs'.padStart(5)} ${'low'.padStart(7)} ${'mid'.padStart(7)} ${'high'.padStart(7)} ${'budget'.padStart(7)}`);
  for (const g of p.groups) L.push(`${`${g.arm} / ${g.entry}`.padEnd(40)} ${g.role.padEnd(10)} ${String(g.tasks.length).padStart(5)} ${String(g.runs).padStart(5)} ${f1(g.creditsLow).padStart(7)} ${f1(g.creditsMid).padStart(7)} ${f1(g.creditsHigh).padStart(7)} ${String(g.budget).padStart(7)}`);
  L.push(`${'TOTAL'.padEnd(40)} ${''.padEnd(10)} ${''.padStart(5)} ${String(p.runs).padStart(5)} ${f1(p.creditsLow).padStart(7)} ${f1(p.creditsMid).padStart(7)} ${f1(p.creditsHigh).padStart(7)} ${String(p.budgetSum).padStart(7)}`);
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

/** True when some remote-tracking branch contains the commit, so another checkout could build it too. */
function onRemote(repo, sha) {
  try { return git(repo, ['branch', '-r', '--contains', sha]).length > 0; } catch { return false; }
}

/**
 * Checks the pinned commits, the skill files each one must hold (`requires` in the manifest), and writes the forced-load prefix of each skill.
 * With `freeze` the commits are also extracted to <base>/trees/<ref> and the arms point at those directories (dir:), which
 * keeps a local-only commit usable after its branch moves.
 */
function buildArms({ base = DEFAULT_BASE, repo = REPO, freeze = false, manifest = loadManifest(), log = () => {} } = {}) {
  const refs = {};
  for (const [key, r] of Object.entries(manifest.refs)) {
    let full;
    try { full = git(repo, ['rev-parse', '--verify', `${r.sha}^{commit}`]); } catch { throw new Error(`commit ${r.sha} (ref ${key}) is not in ${repo}; fetch or create the branch first`); }
    if (full !== r.sha) throw new Error(`manifest ref ${key} must be the full commit id (${full})`);
    refs[key] = { sha: full, onRemote: onRemote(repo, full), tree: null };
    if (freeze) { const dest = path.join(base, 'trees', key); extract(repo, full, dest); refs[key].tree = dest; }
  }
  for (const [key, r] of Object.entries(manifest.refs)) {
    for (const file of r.requires || []) {
      try { git(repo, ['cat-file', '-e', `${refs[key].sha}:${file}`]); } catch { throw new Error(`${file} not found in ${key} (${refs[key].sha})`); }
    }
  }
  const prefixes = {};
  for (const skill of new Set(manifest.groups.map((g) => g.prefixSkill).filter(Boolean))) {
    const text = forcedPrefix({ name: skill, harness: 'kiro-cli' });
    const file = path.join(base, 'prefix', `${skill}.txt`);
    writeFile(file, text + '\n');
    prefixes[skill] = { file, text, sha256: sha256(text + '\n') };
  }
  const arms = {};
  for (const [name, def] of Object.entries(manifest.arms)) {
    const r = refs[def.ref];
    arms[name] = { spec: `${name}=${r.tree ? `dir:${r.tree}` : r.sha}`, role: def.role, ref: def.ref, forced: def.forced };
  }
  const record = { schemaVersion: 1, builtAt: new Date().toISOString(), freeze, refs, prefixes, arms };
  writeFile(path.join(base, 'arms.json'), JSON.stringify(record, null, 2) + '\n');
  log(`refs: ${Object.entries(refs).map(([k, r]) => `${k} ${r.sha.slice(0, 8)}${r.onRemote ? '' : ' (local only)'}`).join(', ')}`);
  return record;
}

function armsRecord(base) {
  const rec = readJson(path.join(base, 'arms.json'));
  if (!rec) throw new Error(`${path.join(base, 'arms.json')} not found; run: node bench/scripts/refs-study.js build-arms --base ${base}`);
  return rec;
}

function groupCommandLine(g, arms) {
  return { spec: arms.arms[g.arm].spec, prefix: g.prefixSkill ? `${g.arm}=${arms.prefixes[g.prefixSkill].file}` : '', agent: `${g.arm}=${g.entry}` };
}

// ---- driver ----

/** Why a real start must not happen now, or null. `procs` is the process list text; the pid files belong to the other driver and to this one. */
function refusalReason({ procs, rootcausePidFile, ownPidFile, isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } }) {
  const bench = String(procs ?? '').split('\n').filter((l) => /bench\/runner\/bench\.js/.test(l) && !/refs-study\.js|refs-report|\bgrep\b/.test(l));
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
  const study = path.join(repo, 'bench', 'scripts', 'refs-study.js');
  return `#!/usr/bin/env bash
# References-read study driver. Generated by: node bench/scripts/refs-study.js driver
# One \`bench.js run\` per (arm, entry agent) group, groups one after another. Kiro only, no AWS keys.
# Re-running resumes at group level: a group with a .done marker is skipped; an interrupted group is moved to
# <group>.partial-<time> (kept, not deleted) and run again from the start, because \`bench.js run --out\` has no run-level resume.
#
#   bash run-all.sh --dry-run     print the plan and the exact commands; changes nothing
#   bash run-all.sh               real start (refuses while another bench process or the root-cause driver runs)
#
# Test hooks: REFS_REPLICATES, REFS_ARMS=a,b, REFS_ONLY_ARM, REFS_PREPARE_ONLY=1 (builds and trial-installs, spends nothing),
# REFS_PROC_LIST=FILE (process list to check instead of ps), REFS_ROOTCAUSE_PID=FILE, REFS_BASE=DIR, REFS_REPO=DIR,
# REFS_AUTH_DB=FILE, REFS_CACHE=DIR, REFS_CARGO_TARGET=DIR, REFS_FREEZE=1 (extract the pinned commits and build the arms from those trees).
set -u
BASE=\${REFS_BASE:-${base}}
REPO=\${REFS_REPO:-${repo}}
STUDY=\$REPO/bench/scripts/refs-study.js
ROOTCAUSE_PID=\${REFS_ROOTCAUSE_PID:-/var/tmp/rootcause/run.pid}
AUTH_DB=\${REFS_AUTH_DB:-\$HOME/.local/share/kiro-cli/data.sqlite3}
OUTBASE=\$BASE/runs
MARK=\$BASE/markers
export TMPDIR=\$BASE/tmp
for v in \$(env | grep -o '^AWS_[A-Za-z_]*'); do unset "\$v"; done

log() { echo "[driver \$(date -u +%FT%TZ)] \$*"; }
# Only 1 or unset is valid: a stale or mistyped value must not turn a real run into a no-op, or the reverse.
case "\${REFS_PREPARE_ONLY:-}" in
  ''|1) ;;
  *) log "REFS_PREPARE_ONLY must be 1 or unset (got another value). Unset it for a real run."; exit 2 ;;
esac
[ -n "\${REFS_PREPARE_ONLY:-}" ] && log "*** PREPARE ONLY: REFS_PREPARE_ONLY=1 is set. Arms are built and trial-installed, no agent runs and nothing is spent. Unset it for a real run. ***"
plan_args=(--base "\$BASE" --repo "\$REPO")
[ -n "\${REFS_REPLICATES:-}" ] && plan_args+=(--replicates "\$REFS_REPLICATES")
[ -n "\${REFS_ARMS:-}" ] && plan_args+=(--arms "\$REFS_ARMS")
[ -n "\${REFS_ONLY_ARM:-}" ] && plan_args+=(--only-arm "\$REFS_ONLY_ARM")
build_args=(--base "\$BASE" --repo "\$REPO")
[ -n "\${REFS_FREEZE:-}" ] && build_args+=(--freeze)

busy() {
  if [ -n "\${REFS_PROC_LIST:-}" ]; then procs=\$(cat "\$REFS_PROC_LIST"); else procs=\$(ps -eo args 2>/dev/null); fi
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
node "\$STUDY" build-arms "\${build_args[@]}" || exit 1
CAP=\$(node "\$STUDY" plan "\${plan_args[@]}" --print-cap)
log "STUDY START cap=\$CAP credits; arms from \$BASE/arms.json"

node "\$STUDY" groups "\${plan_args[@]}" | while IFS='|' read -r arm agent tasks budget runs armspec prefixflag agentflag; do
  name="\${arm}__\${agent}"
  out=\$OUTBASE/\$arm/\$agent
  if [ -e "\$MARK/\$name.done" ] && [ -z "\${REFS_PREPARE_ONLY:-}" ]; then log "GROUP \$name already done, skipping"; continue; fi
  spent=\$(node "\$STUDY" spent --runs "\$OUTBASE")
  if [ -z "\${REFS_PREPARE_ONLY:-}" ] && node -e 'process.exit(Number(process.argv[1]) >= Number(process.argv[2]) ? 0 : 1)' "\$spent" "\$CAP"; then
    log "STOP: charged \$spent reached the study cap \$CAP"; exit 4
  fi
  if [ -e "\$out" ] && [ -z "\${REFS_PREPARE_ONLY:-}" ]; then
    aside=\$out.partial-\$(date -u +%Y%m%dT%H%M%SZ)
    log "GROUP \$name has an unfinished run dir; moving it to \$aside"
    mv "\$out" "\$aside"
  fi
  prefix_args=(); [ -n "\$prefixflag" ] && prefix_args=(--arm-prefix "\$prefixflag")
  agent_args=(); [ -n "\$agentflag" ] && agent_args=(--arm-agent "\$agentflag")
  prep_args=(); [ -n "\${REFS_PREPARE_ONLY:-}" ] && prep_args=(--prepare-only)
  log "GROUP START \$name tasks=\$tasks runs=\$runs budget=\$budget"
  [ -z "\${REFS_PREPARE_ONLY:-}" ] && date -u +%FT%TZ > "\$MARK/\$name.started"
  nice -n 10 node bench/runner/bench.js run --suite references-read --tasks "\$tasks" \\
    --arms "\$armspec" "\${prefix_args[@]}" "\${agent_args[@]}" \\
    --agent-engine ${RUN_FLAGS.engine} --model ${RUN_FLAGS.model} --replicates "\${REFS_REPLICATES:-${REPLICATES}}" --parallel ${RUN_FLAGS.parallel} --seed ${RUN_FLAGS.seed} \\
    --budget-credits "\$budget" --run-credit-limit ${RUN_FLAGS.runCreditLimit} \\
    --repo-root "\$REPO" \\
    --cache "\${REFS_CACHE:-${CACHE}}" --cargo-target "\${REFS_CARGO_TARGET:-${CARGO_TARGET}}" \\
    --auth-db "\$AUTH_DB" "\${prep_args[@]}" \\
    --out "\$out" < /dev/null
  rc=\$?
  log "GROUP END \$name exit=\$rc"
  [ -n "\${REFS_PREPARE_ONLY:-}" ] && continue
  case \$rc in
    0) date -u +%FT%TZ > "\$MARK/\$name.done" ;;
    3) date -u +%FT%TZ > "\$MARK/\$name.done"; echo "credit guard hard stop" > "\$MARK/\$name.budget-stop" ;;
    *) echo "exit \$rc" > "\$MARK/\$name.failed"; log "stopping: group \$name failed with exit \$rc"; exit "\$rc" ;;
  esac
done
rc=\$?
[ \$rc -eq 0 ] && log "ALL GROUPS FINISHED. Score with: node bench/runner/bench.js refs-report --run \$OUTBASE --out \$BASE/report"
exit \$rc
`;
}

function renderStatusScript({ base = DEFAULT_BASE, repo = REPO } = {}) {
  return `#!/usr/bin/env bash
# Read-only status of the references-read study. Calls no AWS, kiro-cli, claude or opencode.
exec node "\${REFS_REPO:-${repo}}/bench/scripts/refs-study.js" status --base "\${REFS_BASE:-${base}}"
`;
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
      if (!fs.statSync(path.join(runs, arm)).isDirectory()) continue;
      for (const agent of fs.readdirSync(path.join(runs, arm)).sort()) {
        const dir = path.join(runs, arm, agent);
        if (!fs.statSync(dir).isDirectory()) continue;
        let n = 0;
        const walk = (d, depth) => { if (depth > 6) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory() && !['workspace', 'session'].includes(e.name)) walk(path.join(d, e.name), depth + 1); else if (e.name === 'result.json') n++; } };
        walk(dir, 0);
        L.push(`  ${`${arm} / ${agent}`.padEnd(40)} runs=${String(n).padStart(3)} credits=${f1(spentUnder(dir)).padStart(7)}`);
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

const str = (v) => (v && v !== true ? v : null);

function planFromArgs(o) {
  return plan({ replicates: o.replicates ? Number(o.replicates) : REPLICATES, arms: str(o.arms) ? String(o.arms).split(',') : null, onlyArm: str(o['only-arm']) });
}

function main(args) {
  const [cmd, ...rest] = args;
  const o = argv(rest);
  const base = str(o.base) ? path.resolve(o.base) : DEFAULT_BASE;
  const repo = str(o.repo) ? path.resolve(o.repo) : REPO;
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
        console.log(`  nice -n 10 node bench/runner/bench.js run --suite references-read --tasks ${g.tasks.join(',')} --arms ${c.spec}${c.prefix ? ` --arm-prefix ${c.prefix}` : ''} --arm-agent ${c.agent} --agent-engine ${RUN_FLAGS.engine} --model ${RUN_FLAGS.model} --replicates ${p.replicates} --parallel ${RUN_FLAGS.parallel} --seed ${RUN_FLAGS.seed} --budget-credits ${g.budget} --run-credit-limit ${RUN_FLAGS.runCreditLimit} --repo-root ${repo} --cache ${CACHE} --cargo-target ${CARGO_TARGET} --out ${path.join(base, 'runs', g.arm, g.entry)}`);
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
    const rec = buildArms({ base, repo, freeze: Boolean(o.freeze), log: (m) => console.error(m) });
    console.log(`arms built at ${base}/arms.json; ${Object.keys(rec.arms).length} arms, ${Object.keys(rec.prefixes).length} prefix files${rec.freeze ? ', commits frozen as directories' : ''}`);
    return;
  }
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
    const why = refusalReason({ procs, rootcausePidFile: str(o['rootcause-pid']), ownPidFile: str(o['own-pid']) });
    if (why) console.log(why);
    return;
  }
  if (cmd === 'status') { console.log(status(base)); return; }
  if (cmd === 'spent') { console.log(spentUnder(path.resolve(str(o.runs) ?? path.join(base, 'runs'))).toFixed(2)); return; }
  console.error('usage: refs-study.js plan|groups|build-arms|driver|refusal|status|spent [flags]');
  process.exitCode = 2;
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`refs-study: ${e.message}`); process.exitCode = 2; }
}

module.exports = { plan, formatPlan, buildArms, refusalReason, renderDriver, renderStatusScript, groupCommandLine, spentUnder, status, onRemote, DEFAULT_BASE, RUN_FLAGS, REPLICATES };
