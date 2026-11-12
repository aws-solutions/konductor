// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap skill-plan | skill-study | decide | criteria`. skill-plan, decide and criteria are free. skill-study spends credits only
// when it runs (not with --init, --status or --dry-run) and calls bench.js run and judge as child processes.

const fs = require('node:fs');
const path = require('node:path');
const { BENCH_DIR, realDir } = require('../runner/lib/tasks.js');
const { optionalProfile } = require('../runner/lib/profiles.js');
const { planSkillStudy, renderPlan, LARGE_DEFAULT, DUPLICATE_PAIRS_DEFAULT, TIERS } = require('./skillplan.js');
const { initStudy, loadStudy, runStudy, decideStudy, studyStatus, makeExec } = require('./skillstudy.js');
const { expandGlob } = require('./usage.js');
const { analyzeStudy, analyzeRuns, buildCriteriaReport, renderCriteria, writeCriteria } = require('./criteria.js');
const { checkMode, checkHeldMin } = require('./forced.js');

const list = (v) => (v === undefined || v === true || v === '' ? [] : String(v).split(',').filter(Boolean));
const val = (v) => (v === undefined || v === true ? undefined : String(v));
const pathOpt = (v) => (v && v !== true ? path.resolve(v) : null);
const num = (v, name) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v === true || !Number.isFinite(n) || n < 0) throw new Error(`--${name} takes a number of 0 or more`);
  return n;
};

function common(opts) {
  const repo = path.resolve(opts['repo-root'] && opts['repo-root'] !== true ? opts['repo-root'] : process.env.BENCH_REPO_ROOT || path.resolve(BENCH_DIR, '..'));
  const benchDir = pathOpt(opts['bench-dir']) ?? BENCH_DIR;
  return { repo, benchDir, extraTasks: list(opts['extra-tasks']).map(realDir) };
}

function runDirsOf(opts) {
  const dirs = list(opts.runs).map((d) => path.resolve(d));
  for (const d of dirs) if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error(`run directory not found: ${d}`);
  for (const g of list(opts['runs-glob'])) {
    const found = expandGlob(g);
    if (!found.length) throw new Error(`--runs-glob ${g} matched no directory (quote the pattern so the shell does not expand it)`);
    dirs.push(...found);
  }
  return [...new Set(dirs)];
}

function creditsPerRun(v) {
  if (v === undefined) return null;
  const parts = String(v).split(',').map(Number);
  if (parts.length === 1) parts.push(parts[0], parts[0]);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) throw new Error('--credits-per-run takes one number or low,mid,high');
  return { low: parts[0], mid: parts[1], high: parts[2] };
}

function duplicatePairs(v) {
  if (v === undefined) return DUPLICATE_PAIRS_DEFAULT;
  return list(v).map((p) => { const [a, b] = p.split(':'); if (!a || !b) throw new Error('--duplicates takes a:b[,c:d]'); return [a, b]; });
}

function planArgs(opts) {
  const { repo, benchDir, extraTasks } = common(opts);
  const base = val(opts.base) ?? 'v1.2.0';
  const tiers = list(opts.tier);
  return {
    repo, base, benchDir, extraTasks, runDirs: runDirsOf(opts), tiers: tiers.length ? tiers : ['all'], skills: list(opts.only).length ? list(opts.only) : null,
    profile: optionalProfile(val(opts.profile) ?? 'detailed'), tasksPerSkill: num(opts['tasks-per-skill'], 'tasks-per-skill'), reps: num(opts.reps, 'reps'),
    maxSections: num(opts['max-sections'], 'max-sections') ?? 3, minSectionBytes: num(opts['min-section-bytes'], 'min-section-bytes'),
    largeNames: opts.large === undefined ? LARGE_DEFAULT : list(opts.large), largeTop: num(opts['large-top'], 'large-top') ?? 12, duplicatePairs: duplicatePairs(opts.duplicates),
    model: val(opts.model) ?? 'claude-sonnet-5.5', agentEngine: val(opts['agent-engine']) ?? 'v3', armConfig: val(opts['arm-config']) ?? null,
    creditsPerRun: creditsPerRun(opts['credits-per-run']), secPerRun: num(opts['sec-per-run'], 'sec-per-run') ?? null, judgeUsdPerRun: num(opts['judge-usd-per-run'], 'judge-usd-per-run'),
    budgetCredits: num(opts['budget-credits'], 'budget-credits') ?? null, allowRegex: Boolean(opts['allow-regex']),
    screen: Boolean(opts.screen), screenTasks: num(opts['screen-tasks'], 'screen-tasks') ?? 5, forcedLoad: checkMode(opts['forced-load']) === 'off' ? null : checkMode(opts['forced-load']),
  };
}

const withoutUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function cmdSkillPlan(opts) {
  const plan = planSkillStudy(withoutUndefined(planArgs(opts)));
  if (opts.out && opts.out !== true) {
    const out = path.resolve(opts.out);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'skill-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    fs.writeFileSync(path.join(out, 'skill-plan.md'), renderPlan(plan));
  }
  console.log(opts.json ? JSON.stringify(plan, null, 2) : renderPlan(plan));
}

function settingsFrom(opts, studyDir, repo, benchDir, extraTasks, base, profile) {
  return withoutUndefined({
    repo, base, benchDir, extraTasks, scratch: pathOpt(opts.scratch) ?? path.join(studyDir, 'scratch'), engine: val(opts['agent-engine']) ?? 'v3', model: val(opts.model) ?? 'claude-sonnet-5.5',
    profile: profile.name, seed: num(opts.seed, 'seed') ?? 20261103, controlReps: num(opts['control-reps'], 'control-reps') ?? 5, parallel: 1, concurrency: 2, ...runtimeOverrides(opts),
  });
}

// Settings that depend on the machine or the moment (credentials, binaries, caches), so a resume can change them.
function runtimeOverrides(opts) {
  return withoutUndefined({
    judgeBackend: val(opts['judge-backend']) ?? 'opencode', credsFile: val(opts['aws-creds-file']) ?? process.env.CREDS ?? process.env.SKILL_BENCH_CREDS,
    awsProfile: val(opts['aws-profile']), awsRegion: val(opts['aws-region']), budgetUsdPerWave: num(opts['budget-usd'], 'budget-usd') ?? 15,
    budgetCreditsPerWave: num(opts['wave-budget-credits'], 'wave-budget-credits'), authDb: val(opts['auth-db']), cache: val(opts.cache), cargoTarget: val(opts['cargo-target']),
    kiroBin: val(opts['kiro-bin']), opencodeBin: val(opts['opencode-bin']), forcedLoad: checkMode(opts['forced-load']) ?? undefined,
    forcedHeldMin: checkHeldMin(opts['forced-held-min']) ?? undefined,
  });
}

async function cmdSkillStudy(opts) {
  const studyArg = val(opts.study);
  if (!studyArg) throw new Error('--study DIR is required');
  const studyDir = path.resolve(studyArg);
  checkMode(opts['forced-load']);
  checkHeldMin(opts['forced-held-min']);
  const waves = val(opts.waves) ?? 'all';
  if (!['all', '1'].includes(waves)) throw new Error('--waves takes 1 (controls and wave 1 only) or all');
  if (opts.status) { console.log(studyStatus(studyDir)); return; }
  if (opts.init) {
    const args = planArgs(opts);
    const plan = planSkillStudy(withoutUndefined(args));
    const settings = settingsFrom(opts, studyDir, args.repo, args.benchDir, args.extraTasks, args.base, args.profile);
    const r = initStudy({ studyDir, plan, settings });
    fs.writeFileSync(path.join(studyDir, 'skill-plan.md'), renderPlan(r.study.plan));
    console.log(`${r.existing ? 'study already planned' : 'planned study'} at ${studyDir}: ${r.study.plan.skills.filter((s) => s.lift).length} skills with a lift study, ${r.study.plan.skills.filter((s) => !s.lift).length} triage; plan in ${path.join(studyDir, 'skill-plan.md')}`);
    return;
  }
  const study = loadStudy(studyDir);
  const tiers = list(opts.tier);
  for (const t of tiers) if (t !== 'all' && !TIERS.includes(t)) throw new Error(`--tier takes ${TIERS.join(', ')} or all (got "${t}")`);
  const exec = makeExec({ cwd: study.settings.repo });
  let stop = false;
  const onSig = () => { stop = true; exec.terminate?.(); };
  process.once('SIGTERM', onSig);
  process.once('SIGINT', onSig);
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
  const r = await runStudy({ studyDir, exec, log, tiers: tiers.length ? tiers : ['all'], skills: list(opts.only).length ? list(opts.only) : null, dryRun: Boolean(opts['dry-run']), shouldStop: () => stop, overrides: runtimeOverrides(opts), waves });
  if (r.stopped) { console.error(`study stopped: ${r.stopped}`); process.exitCode = 1; }
}

function cmdDecide(opts) {
  const studyArg = val(opts.study);
  if (!studyArg) throw new Error('--study DIR is required');
  const studyDir = path.resolve(studyArg);
  const r = decideStudy({ studyDir, outDir: pathOpt(opts.out), patches: !opts['no-patches'], heldMin: checkHeldMin(opts['forced-held-min']) });
  if (opts.json) { console.log(JSON.stringify(r.decisions, null, 2)); return; }
  const by = {};
  for (const d of r.decisions) (by[d.decision] ??= []).push(d.name);
  for (const k of ['DELETE', 'PRUNE', 'KEEP', 'NEEDS DATA']) console.log(`${k}: ${(by[k] ?? []).length}${(by[k] ?? []).length && k !== 'NEEDS DATA' ? ` (${by[k].join(', ')})` : ''}`);
  console.log(`wrote ${path.join(r.outDir, 'decisions.md')}, decisions.json, evidence.json and patches/ (nothing was applied)`);
}

// Thresholds for cap criteria: a plain decimal in the given range, checked before anything is read.
function threshold(v, name, { min, max, minOpen = false, integer = false, what }) {
  if (v === undefined) return undefined;
  const text = v === true ? '' : String(v).trim();
  const n = /^\d+(\.\d+)?$|^\.\d+$/.test(text) ? Number(text) : NaN;
  const ok = Number.isFinite(n) && (minOpen ? n > min : n >= min) && n <= max && (!integer || Number.isInteger(n));
  if (!ok) throw new Error(`--${name} takes ${what} (got ${v === true ? 'no value' : `"${v}"`})`);
  return n;
}

const CRITERIA_FLAGS = [
  ['margin', 'margin', { min: 0, max: 1, minOpen: true, what: 'a number above 0 and at most 1' }],
  ['saturated', 'saturated', { min: 0.5, max: 1, minOpen: true, what: 'a number above 0.5 and at most 1' }],
  ['judgeDisagree', 'judge-disagree', { min: 0, max: 1, what: 'a share from 0 to 1' }],
  ['replicateSd', 'replicate-sd', { min: 0, max: 1, what: 'a standard deviation from 0 to 1' }],
  ['minRuns', 'min-runs', { min: 1, max: Number.MAX_SAFE_INTEGER, integer: true, what: 'a whole number of 1 or more' }],
];

function criteriaConfig(opts) {
  const out = {};
  for (const [key, flag, rule] of CRITERIA_FLAGS) { const n = threshold(opts[flag], flag, rule); if (n !== undefined) out[key] = n; }
  if (opts['no-adjust']) out.adjust = false;
  return out;
}

function cmdCriteria(opts) {
  const config = criteriaConfig(opts);
  const studyArg = val(opts.study);
  const dirs = runDirsOf(opts);
  if (!studyArg && !dirs.length) throw new Error('--study DIR or --runs DIR[,DIR] is required');
  if (studyArg && dirs.length) throw new Error('give --study or --runs, not both');
  const extra = list(opts['extra-tasks']).map(realDir);
  let groups;
  let outDir = pathOpt(opts.out);
  let source;
  if (studyArg) {
    const studyDir = path.resolve(studyArg);
    groups = analyzeStudy({ studyDir, config, benchDir: pathOpt(opts['bench-dir']), extraTasks: extra.length ? extra : null });
    outDir = outDir ?? path.join(studyDir, 'criteria');
    source = `study ${studyDir}`;
  } else {
    groups = analyzeRuns({ dirs, benchDir: pathOpt(opts['bench-dir']) ?? BENCH_DIR, extraTasks: extra, baseline: val(opts.baseline) ?? null, aa: val(opts.aa) ?? null, config });
    source = `runs ${dirs.join(', ')}`;
  }
  const report = buildCriteriaReport(groups, { source, config });
  const written = outDir ? writeCriteria(outDir, report) : [];
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else if (!outDir) console.log(renderCriteria(report));
  else console.log(`${report.summary.flagged} of ${report.summary.items} items flagged (${Object.entries(report.summary.byFlag).map(([k, n]) => `${k} ${n}`).join(', ')}); wrote ${written.join(', ')} (advisory; no call was changed)`);
}

module.exports = { cmdSkillPlan, cmdSkillStudy, cmdDecide, cmdCriteria, criteriaConfig };
