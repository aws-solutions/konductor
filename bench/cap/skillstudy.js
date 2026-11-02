// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-skill study driver behind `cap skill-study`. One shared study directory holds a plan (study.json), one folder
// per skill with its waves, and the decisions. Waves: 1 control, A/A and delete; 2 section removals (only if removing
// the skill lost quality); 3 moves to references (only for sections whose removal lost quality). Every step is resumable:
// a finished wave is skipped, an unfinished one is moved to incomplete/ and rerun, and nothing is ever deleted.
// All bench.js calls go through `exec`, so tests replace it with a fake and no model is called.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadTasks } = require('../runner/lib/tasks.js');
const { scoringOf } = require('./captasks.js');
const { buildVariant } = require('./variant.js');
const { guardInstalls } = require('./guard.js');
const { ablationFor } = require('./ablate.js');
const { writeControls, KEEP_SKILL, PRUNE_SKILL } = require('./controls.js');
const { suiteFor } = require('./plan.js');
const { resolveBase } = require('./source.js');
const { scanRepo } = require('./scan.js');
const { readWave, waveComplete, buildSkillPatch } = require('./studyio.js');
const { decideSkill, evidenceRowsFor, compareArms, variantStatus, renderDecisions } = require('./decide.js');

const BENCH_JS = path.join(__dirname, '..', 'runner', 'bench.js');
const STUDY_FILE = 'study.json';
const CONTROL_ARMS = ['base', 'base-b', 'ctl-keep', 'ctl-prune'];
const CONTROL_TASKS = ['control-keep', 'control-prune'];
const ACTING_AGENT = 'konductor';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(o, null, 2)}\n`); };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

const paths = (studyDir) => ({
  root: studyDir, study: path.join(studyDir, STUDY_FILE), skills: path.join(studyDir, 'skills'), controls: path.join(studyDir, 'controls'),
  controlRun: path.join(studyDir, 'controls', 'run'), incomplete: path.join(studyDir, 'incomplete'), logs: path.join(studyDir, 'logs'), decisions: path.join(studyDir, 'decisions'),
  screen: (id) => path.join(studyDir, 'screens', id), skill: (n) => path.join(studyDir, 'skills', n), wave: (n, w) => path.join(studyDir, 'skills', n, `w${w}`),
});

/** Writes study.json once. A second call with the same base commit keeps the first plan, so a rerun resumes it. */
function initStudy({ studyDir, plan, settings }) {
  const p = paths(studyDir);
  const existing = readJson(p.study);
  if (existing) {
    if (existing.plan.base.commitSha !== plan.base.commitSha) throw new Error(`${p.study} was planned at ${existing.plan.base.label}, not ${plan.base.label}; use a new study directory`);
    return { existing: true, study: existing };
  }
  const study = { schemaVersion: 1, createdAt: new Date().toISOString(), plan, settings };
  writeJson(p.study, study);
  return { existing: false, study };
}

function loadStudy(studyDir) {
  const s = readJson(paths(studyDir).study);
  if (!s) throw new Error(`no study at ${studyDir} (${STUDY_FILE} is missing); create one with cap skill-study --init`);
  return s;
}

// ---- arms ----

const pairs = (ids, value) => (value ? ids.map((id) => `${id}=${value}`).join(',') : null);
const armKind = (id) => (id === 'ctl' ? 'control' : id === 'ctl-b' ? 'aa' : id === 'del' ? 'delete' : id.startsWith('rm') ? 'remove' : 'move');

function ablationOf(study, rec, baseText) {
  const prof = study.plan.profile;
  const a = ablationFor({ name: rec.name, text: baseText, max: prof.maxSections, minBytes: prof.minSectionBytes ?? undefined });
  const same = a.candidates.length === rec.sections.length && a.candidates.every((c, i) => c.id === rec.sections[i].id && c.startLine === rec.sections[i].startLine && c.endLine === rec.sections[i].endLine);
  if (!same) throw new Error(`skills/${rec.name}/SKILL.md changed since the plan was made; plan again`);
  return a;
}

function baseTextOf(study, name) {
  const b = resolveBase(study.settings.base, study.settings.repo);
  try {
    const rec = scanRepo(b.dir).get(`skill:${name}`);
    if (!rec) throw new Error(`skill:${name} does not exist at ${b.label}`);
    return rec.text;
  } finally { b.cleanup(); }
}

/**
 * Builds the dir: arms of one wave and returns { specs: {armId: spec}, meta, refPaths }. Overlay folders are kept under the
 * skill's study folder so the exact files that were run stay on disk.
 */
function materialize(study, rec, armIds, studyDir) {
  const { settings } = study;
  const text = baseTextOf(study, rec.name);
  const abl = ablationOf(study, rec, text);
  const byId = new Map(abl.variants.map((v) => [v.id, v]));
  const specs = {};
  const meta = {};
  const refPaths = {};
  const scratch = settings.scratch;
  for (const id of armIds) {
    const v = byId.get(id);
    meta[id] = { kind: armKind(id), section: v?.section?.id ?? null, range: v?.range ?? null };
    if (id === 'ctl' || id === 'ctl-b') { specs[id] = `${id}=${settings.base}`; continue; }
    if (!v) throw new Error(`no variant ${id} for skill:${rec.name}`);
    let built;
    if (v.kind === 'delete') {
      built = guardInstalls(() => buildVariant({ repo: settings.repo, base: settings.base, drop: [rec.id], scratch, agentEngine: study.plan.engine }));
    } else {
      const dir = path.join(paths(studyDir).skill(rec.name), 'overlays', id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), v.text);
      for (const [rel, body] of Object.entries(v.files ?? {})) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); }
      built = guardInstalls(() => buildVariant({ repo: settings.repo, base: settings.base, overlay: [`${rec.id}=${dir}`], scratch, agentEngine: study.plan.engine }));
      if (v.kind === 'move') refPaths[id] = Object.keys(v.files)[0];
    }
    specs[id] = `${id}=dir:${built.dir}`;
    meta[id].variantHash = built.meta.variantHash;
  }
  return { specs, meta, refPaths };
}

// ---- commands ----

function commonFlags(study, extraTasks) {
  const s = study.settings;
  const f = ['--bench-dir', s.benchDir, '--repo-root', s.repo];
  const extra = extraTasks ?? s.extraTasks ?? [];
  if (extra.length) f.push('--extra-tasks', extra.join(','));
  return f;
}

function runArgv(study, { tasks, specs, armIds, out, reps, armAgent, armConfig, suite, extraTasks }) {
  const s = study.settings;
  const argv = ['run', '--suite', suite, '--tasks', tasks.join(','), '--arms', armIds.map((id) => specs[id]).join(','), '--replicates', String(reps), '--parallel', String(s.parallel ?? 1),
    '--seed', String(s.seed), '--agent-engine', study.plan.engine, '--model', study.plan.model, '--profile', study.plan.profile.name, '--out', out, ...commonFlags(study, extraTasks)];
  const cfg = pairs(armIds, armConfig);
  if (cfg) argv.push('--arm-config', cfg);
  const ag = pairs(armIds, armAgent);
  if (ag) argv.push('--arm-agent', ag);
  for (const [flag, key] of [['auth-db', 'authDb'], ['cache', 'cache'], ['cargo-target', 'cargoTarget'], ['kiro-bin', 'kiroBin']]) if (s[key]) argv.push(`--${flag}`, s[key]);
  if (s.budgetCreditsPerWave) argv.push('--budget-credits', String(s.budgetCreditsPerWave));
  return argv;
}

function judgeArgv(study, dir) {
  const s = study.settings;
  const argv = ['judge', '--run', dir, '--judge-backend', s.judgeBackend ?? 'opencode', '--aws-creds-file', s.credsFile, '--profile', study.plan.profile.name, '--baseline', 'ctl',
    '--budget-usd', String(s.budgetUsdPerWave ?? 15), '--concurrency', String(s.concurrency ?? 2), '--bench-dir', s.benchDir];
  if (s.awsProfile) argv.push('--aws-profile', s.awsProfile);
  if (s.awsRegion) argv.push('--aws-region', s.awsRegion);
  if (s.opencodeBin) argv.push('--opencode-bin', s.opencodeBin);
  if (s.extraTasks?.length) argv.push('--extra-tasks', s.extraTasks.join(','));
  return argv;
}

// ---- the loop ----

function tasksNeedJudge(study, ids) {
  const tasks = loadTasks(study.settings.benchDir, { extraDirs: study.settings.extraTasks ?? [] });
  return ids.some((id) => tasks.has(id) && scoringOf(tasks.get(id)) !== 'hidden');
}

function suiteOf(study, ids) {
  const tasks = loadTasks(study.settings.benchDir, { extraDirs: study.settings.extraTasks ?? [] });
  return suiteFor(ids.map((id) => tasks.get(id)).filter(Boolean));
}

function moveAside(studyDir, dir, label) {
  if (!fs.existsSync(dir)) return;
  const dest = path.join(paths(studyDir).incomplete, `${label}-${stamp()}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(dir, dest);
}


function screenOf(study, rec) { return rec.screen ? (study.plan.screens ?? []).find((x) => x.id === rec.screen) ?? null : null; }

/** The directory, arm count and task count that hold wave n of a skill; wave 1 of a screened skill lives in the shared screen. */
function waveWhere(study, studyDir, rec, n) {
  const p = paths(studyDir);
  const sc = n === 1 ? screenOf(study, rec) : null;
  if (sc) return { dir: p.screen(sc.id), arms: sc.arms.length, tasks: sc.tasks.length, screen: sc };
  const arms = readJson(path.join(p.skill(rec.name), `w${n}.arms.json`));
  return { dir: p.wave(rec.name, n), arms: arms?.arms.length ?? 0, tasks: rec.tasks.chosen.length, screen: null, armsFile: arms };
}

/** Scores per arm for wave n of a skill. A screened skill's delete arm is named del-<skill> in the shared run; it is shown as del. */
function readSkillWave(study, studyDir, rec, n) {
  const where = waveWhere(study, studyDir, rec, n);
  const refPaths = where.armsFile?.refPaths ?? {};
  const w = readWave({ dir: where.dir, benchDir: study.settings.benchDir, extraTasks: study.settings.extraTasks ?? [], skill: rec.name, refPaths });
  if (where.screen) w.arms = { ctl: w.arms.ctl, 'ctl-b': w.arms['ctl-b'], del: w.arms[`del-${rec.name}`] };
  return w;
}

function skillWaveComplete(study, studyDir, rec, n) {
  const where = waveWhere(study, studyDir, rec, n);
  if (!where.arms || !fs.existsSync(where.dir)) return false;
  return waveComplete(where.dir, { arms: where.arms, reps: study.plan.profile.reps, tasks: where.tasks }).complete;
}

function statusesOf(study, studyDir, rec, n, armIds) {
  const w = readSkillWave(study, studyDir, rec, n);
  const ctl = w.arms.ctl;
  const aa = w.arms['ctl-b'];
  const aaCmp = ctl && aa ? compareArms(aa.scores, ctl.scores) : { delta: null };
  const aaSpread = aaCmp.delta === null ? 0 : Math.abs(aaCmp.delta);
  const out = {};
  for (const id of armIds.filter((x) => x !== 'ctl' && x !== 'ctl-b')) if (w.arms[id] && ctl) out[id] = variantStatus(w.arms[id], ctl, aaSpread).status;
  return out;
}

function creditsFile(dirs) {
  let total = 0;
  let runs = 0;
  for (const d of dirs) {
    let t = '';
    try { t = fs.readFileSync(path.join(d, 'credit-ledger.jsonl'), 'utf8'); } catch { continue; }
    for (const l of t.split('\n').filter(Boolean)) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.kind === 'run') { runs++; total += Number(e.charged ?? e.credits ?? 0) || 0; }
    }
  }
  return { total, runs };
}

function checkCreds(study, selected, log, dryRun) {
  const needs = selected.some((rec) => tasksNeedJudge(study, rec.tasks?.chosen ?? []));
  if (!needs) return;
  const f = study.settings.credsFile;
  let ok = false;
  try { ok = Boolean(f) && fs.statSync(f).isFile() && fs.statSync(f).size > 0; } catch { ok = false; }
  if (ok) return;
  const msg = `credentials file ${f || '(not set)'} is missing or empty; judging needs fresh credentials (set CREDS or --aws-creds-file)`;
  if (dryRun) { log(`WARNING: ${msg}`); return; }
  throw new Error(msg);
}

/**
 * Runs (or with dryRun, only prints) the study. `exec({ argv, label })` runs one bench.js command and returns { code }.
 * Returns { decisions, stopped, dryRun }; `stopped` is set when controls failed, a command failed or a stop was requested.
 */
async function runStudy({ studyDir, exec, log = () => {}, tiers = ['all'], skills = null, dryRun = false, shouldStop = () => false, overrides = null }) {
  const study = loadStudy(studyDir);
  if (overrides) Object.assign(study.settings, overrides);
  const p = paths(studyDir);
  const sel = study.plan.skills.filter((s) => s.lift && (tiers.includes('all') || tiers.includes(s.tier)) && (!skills || skills.includes(s.name)));
  checkCreds(study, sel, log, dryRun);
  fs.mkdirSync(p.logs, { recursive: true });
  const result = { dryRun, stopped: null, decisions: [] };
  const step = async (label, argv) => {
    if (shouldStop()) { result.stopped = 'stop-requested'; return null; }
    log(`${label}: node bench/runner/bench.js ${argv.join(' ')}`);
    return exec({ argv, label, logFile: path.join(p.logs, `${label.replace(/[^A-Za-z0-9._-]+/g, '-')}.log`) });
  };

  // 1. known-answer controls, once per study
  const controls = await controlsStep({ study, studyDir, step, log, dryRun, tiers: sel, result });
  if (!result.stopped && controls.trusted !== true && !dryRun) result.stopped = controls.ran ? 'controls-failed' : result.stopped;
  if (!result.stopped || dryRun) {
    for (const sc of (study.plan.screens ?? []).filter((x) => x.skills.some((n) => sel.some((r) => r.name === n)))) {
      if (result.stopped && !dryRun) break;
      await screenStep({ study, studyDir, sc, step, log, dryRun, result, controlsTrusted: controls.trusted });
    }
    for (const rec of sel) {
      if (result.stopped) break;
      await skillSteps({ study, studyDir, rec, step, log, dryRun, result, controlsTrusted: controls.trusted });
    }
  }
  if (!dryRun) result.decisions = decideStudy({ studyDir }).decisions;
  return result;
}

async function controlsStep({ study, studyDir, step, log, dryRun, result }) {
  const p = paths(studyDir);
  const check = () => readJson(path.join(p.controlRun, 'controls-check.json'));
  const done = check();
  if (done) return { trusted: done.trusted === true, ran: false };
  const reps = study.settings.controlReps ?? 5;
  const armConfig = study.plan.armConfig;
  log(`controls: 4 arms x 2 tasks x ${reps} replicates (known-answer keep and decoy skills) must pass before any skill verdict is trusted`);
  if (dryRun) { log(`controls: run --suite cap --tasks ${CONTROL_TASKS.join(',')} --arms ${CONTROL_ARMS.join(',')} --replicates ${reps} --out ${p.controlRun}`); return { trusted: null, ran: false }; }
  const writes = writeControls({ outDir: studyDir });
  const mk = (file, name) => guardInstalls(() => buildVariant({ repo: study.settings.repo, base: study.settings.base, add: [`skill:${name}=${file}`], toAgent: [ACTING_AGENT], scratch: study.settings.scratch, agentEngine: study.plan.engine }));
  const keep = mk(writes.keepFile, KEEP_SKILL);
  const prune = mk(writes.pruneFile, PRUNE_SKILL);
  const specs = { base: `base=${study.settings.base}`, 'base-b': `base-b=${study.settings.base}`, 'ctl-keep': `ctl-keep=dir:${keep.dir}`, 'ctl-prune': `ctl-prune=dir:${prune.dir}` };
  const extra = [...(study.settings.extraTasks ?? []), writes.tasksDir];
  if (fs.existsSync(p.controlRun) && !waveComplete(p.controlRun, { arms: 4, reps, tasks: 2 }).complete) moveAside(studyDir, p.controlRun, 'controls');
  if (!fs.existsSync(p.controlRun)) {
    const r = await step('controls-run', runArgv(study, { tasks: CONTROL_TASKS, specs, armIds: CONTROL_ARMS, out: p.controlRun, reps, armConfig, suite: 'cap', extraTasks: extra }));
    if (!r) return { trusted: null, ran: false };
    if (r.code !== 0) { result.stopped = 'controls-run-failed'; return { trusted: null, ran: true }; }
  }
  const r = await step('controls-check', ['cap', 'controls', '--check', p.controlRun, '--base-arm', 'base', '--aa', 'base-b', '--keep', 'ctl-keep', '--prune', 'ctl-prune', '--extra-tasks', extra.join(','), '--bench-dir', study.settings.benchDir]);
  if (!r) return { trusted: null, ran: true };
  const c = check();
  return { trusted: c ? c.trusted === true : false, ran: true };
}

async function screenStep({ study, studyDir, sc, step, log, dryRun, result }) {
  const p = paths(studyDir);
  const dir = p.screen(sc.id);
  const reps = study.plan.profile.reps;
  const judged = tasksNeedJudge(study, sc.tasks);
  const suite = suiteOf(study, sc.tasks);
  log(`${sc.id}: arms ${sc.arms.join(', ')}`);
  if (dryRun) { log(`  ${sc.id}: run --suite ${suite} --tasks ${sc.tasks.join(',')} --replicates ${reps} --out ${dir}${judged ? ' (then judge on the opencode backend)' : ''}`); return; }
  const mark = path.join(p.root, 'screens', `${sc.id}.done`);
  const state = fs.existsSync(dir) ? waveComplete(dir, { arms: sc.arms.length, reps, tasks: sc.tasks.length }) : { complete: false };
  if (!state.complete) {
    moveAside(studyDir, dir, sc.id);
    fs.rmSync(mark, { force: true });
    const specs = { ctl: `ctl=${study.settings.base}`, 'ctl-b': `ctl-b=${study.settings.base}` };
    for (const name of sc.skills) {
      const v = guardInstalls(() => buildVariant({ repo: study.settings.repo, base: study.settings.base, drop: [`skill:${name}`], scratch: study.settings.scratch, agentEngine: study.plan.engine }));
      specs[`del-${name}`] = `del-${name}=dir:${v.dir}`;
    }
    writeJson(path.join(p.root, 'screens', `${sc.id}.arms.json`), { arms: sc.arms, specs });
    const r = await step(`${sc.id}-run`, runArgv(study, { tasks: sc.tasks, specs, armIds: sc.arms, out: dir, reps, armAgent: sc.entry.armAgent, armConfig: sc.entry.armConfig, suite }));
    if (!r) return;
    if (r.code !== 0 || !waveComplete(dir, { arms: sc.arms.length, reps, tasks: sc.tasks.length }).complete) { log(`${sc.id}: did not finish cleanly (exit ${r.code})`); result.stopped = `wave-failed:${sc.id}`; return; }
  }
  if (judged && !fs.existsSync(path.join(dir, 'judgments.json'))) {
    const r = await step(`${sc.id}-judge`, judgeArgv(study, dir));
    if (!r) return;
    if (r.code !== 0) { result.stopped = `judge-failed:${sc.id}`; return; }
  }
  fs.writeFileSync(mark, `${new Date().toISOString()}\n`);
}

async function skillSteps({ study, studyDir, rec, step, log, dryRun, result, controlsTrusted }) {
  const p = paths(studyDir);
  const reps = study.plan.profile.reps;
  const chosen = rec.tasks.chosen;
  if (!chosen.length) { log(`${rec.name}: no runnable task (draft scenarios first: ${rec.tasks.scenarioCommand ?? 'none'}); skipped`); return; }
  const judged = tasksNeedJudge(study, chosen);
  const suite = suiteOf(study, chosen);
  const armConfig = rec.reach.armConfig;
  const armAgent = rec.reach.armAgent;
  fs.mkdirSync(p.skill(rec.name), { recursive: true });

  const runWave = async (n, armIds) => {
    const dir = p.wave(rec.name, n);
    const doneMark = path.join(p.skill(rec.name), `w${n}.done`);
    log(`${rec.name} wave ${n}: arms ${armIds.join(', ')}`);
    if (dryRun) { log(`  ${rec.name} wave ${n}: run --suite ${suite} --tasks ${chosen.join(',')} --replicates ${reps} --out ${dir}${judged ? ' (then judge on the opencode backend)' : ''}`); return true; }
    const state = fs.existsSync(dir) ? waveComplete(dir, { arms: armIds.length, reps, tasks: chosen.length }) : { complete: false };
    if (!state.complete) {
      moveAside(studyDir, dir, `${rec.name}-w${n}`);
      fs.rmSync(doneMark, { force: true });
      const m = materialize(study, rec, armIds, studyDir);
      writeJson(path.join(p.skill(rec.name), `w${n}.arms.json`), { arms: armIds, meta: m.meta, refPaths: m.refPaths, specs: m.specs });
      const r = await step(`${rec.name}-w${n}-run`, runArgv(study, { tasks: chosen, specs: m.specs, armIds, out: dir, reps, armAgent, armConfig, suite }));
      if (!r) return false;
      if (r.code !== 0 || !waveComplete(dir, { arms: armIds.length, reps, tasks: chosen.length }).complete) { log(`${rec.name} wave ${n}: did not finish cleanly (exit ${r.code})`); result.stopped = `wave-failed:${rec.name}:w${n}`; return false; }
    }
    if (judged && !fs.existsSync(path.join(dir, 'judgments.json'))) {
      const r = await step(`${rec.name}-w${n}-judge`, judgeArgv(study, dir));
      if (!r) return false;
      if (r.code !== 0) { result.stopped = `judge-failed:${rec.name}:w${n}`; return false; }
    }
    fs.writeFileSync(doneMark, `${new Date().toISOString()}\n`);
    return true;
  };

  if (rec.screen) {
    if (dryRun) { log(`${rec.name} wave 1: shared ${rec.screen}`); return; }
    if (!skillWaveComplete(study, studyDir, rec, 1)) return;
  } else if (!(await runWave(1, ['ctl', 'ctl-b', 'del']))) return;
  if (dryRun || controlsTrusted === false) return;
  if (!rec.sections.length) { fs.writeFileSync(path.join(p.skill(rec.name), 'w2.skipped'), 'no sections to test\n'); return; }
  const s1 = statusesOf(study, studyDir, rec, 1, ['del']);
  if (s1.del !== 'lost') { fs.writeFileSync(path.join(p.skill(rec.name), 'w2.skipped'), `delete variant ${s1.del ?? 'unread'}; sections are tested only when removing the skill lost quality\n`); return; }
  const rm = rec.sections.map((_, i) => `rm${i + 1}`);
  if (!(await runWave(2, ['ctl', 'ctl-b', ...rm]))) return;
  const s2 = statusesOf(study, studyDir, rec, 2, rm);
  const mv = rec.sections.map((_, i) => i + 1).filter((k) => s2[`rm${k}`] === 'lost').map((k) => `mv${k}`);
  if (!mv.length) { fs.writeFileSync(path.join(p.skill(rec.name), 'w3.skipped'), 'no section removal lost quality\n'); return; }
  await runWave(3, ['ctl', 'ctl-b', ...mv]);
}

// ---- decisions ----

function decideStudy({ studyDir, outDir = null, patches = true }) {
  const study = loadStudy(studyDir);
  const p = paths(studyDir);
  const out = outDir ?? p.decisions;
  const ctl = readJson(path.join(p.controlRun, 'controls-check.json'));
  const controls = { trusted: ctl ? ctl.trusted === true : null };
  const decisions = [];
  const evidence = [];
  for (const rec of study.plan.skills) {
    if (!rec.lift) {
      decisions.push({
        skill: rec.id, name: rec.name, tier: rec.tier, decision: 'NEEDS DATA', confidence: 'low', verdict: 'incomplete', reasons: [rec.why, `prune-report class ${rec.staticClass}; loaded in ${rec.exposure.runsLoaded} of ${rec.exposure.exposed} exposed runs`],
        next: rec.steps, sections: [], tokensSaved: 0, missing: [], evidence: { del: null, sections: {} }, estTokens: rec.estTokens,
      });
      continue;
    }
    const waves = [];
    for (const n of [1, 2, 3]) {
      if (!skillWaveComplete(study, studyDir, rec, n)) continue;
      const w = readSkillWave(study, studyDir, rec, n);
      waves.push({ wave: n, arms: w.arms, opened: w.opened });
    }
    const d = decideSkill({ skill: { id: rec.id, name: rec.name, estTokens: rec.estTokens, sections: rec.sections }, controls, waves });
    const full = { ...d, tier: rec.tier, waves: waves.map((w) => w.wave), estTokens: rec.estTokens };
    if (patches && ['DELETE', 'PRUNE'].includes(d.decision)) {
      try {
        const patch = buildSkillPatch({ repo: study.settings.repo, base: study.settings.base, decision: full });
        if (patch) { full.patch = { file: path.join('patches', `${rec.name}.patch`), files: patch.files }; fs.mkdirSync(path.join(out, 'patches'), { recursive: true }); fs.writeFileSync(path.join(out, 'patches', `${rec.name}.patch`), patch.patch); }
      } catch (e) { full.patchError = e.message; }
    }
    evidence.push(...evidenceRowsFor(d, { runId: path.relative(studyDir, p.wave(rec.name, 1)) }));
    decisions.push(full);
  }
  fs.mkdirSync(out, { recursive: true });
  const meta = { base: study.plan.base.label, createdAt: new Date().toISOString(), controls, plan: { profile: study.plan.profile, model: study.plan.model, engine: study.plan.engine } };
  writeJson(path.join(out, 'decisions.json'), { ...meta, decisions });
  writeJson(path.join(out, 'evidence.json'), evidence);
  fs.writeFileSync(path.join(out, 'decisions.md'), renderDecisions(decisions, meta));
  return { decisions, outDir: out };
}

// ---- status ----

function studyStatus(studyDir) {
  const study = loadStudy(studyDir);
  const p = paths(studyDir);
  const lines = [`study dir: ${studyDir}`, `base: ${study.plan.base.label}; ${study.plan.profile.reps} replicates, ${study.plan.profile.tasksPerSkill} tasks per skill, model ${study.plan.model}, engine ${study.plan.engine}`];
  const c = readJson(path.join(p.controlRun, 'controls-check.json'));
  lines.push(`controls: ${c ? (c.trusted ? 'passed' : 'FAILED') : fs.existsSync(p.controlRun) ? 'running or unchecked' : 'not run'}`);
  let done = 0;
  let total = 0;
  const dirs = fs.existsSync(p.controlRun) ? [p.controlRun] : [];
  const per = [];
  for (const rec of study.plan.skills.filter((s) => s.lift)) {
    const marks = [1, 2, 3].map((n) => {
      const shared = n === 1 ? screenOf(study, rec) : null;
      const dir = shared ? p.screen(shared.id) : p.wave(rec.name, n);
      const isDone = fs.existsSync(shared ? path.join(p.root, 'screens', `${shared.id}.done`) : path.join(p.skill(rec.name), `w${n}.done`));
      const skipped = fs.existsSync(path.join(p.skill(rec.name), `w${n}.skipped`));
      const started = fs.existsSync(dir);
      if (isDone) { done++; total++; if (!dirs.includes(dir)) dirs.push(dir); return `w${n} done${shared ? ` (shared ${shared.id})` : ''}`; }
      if (skipped) return `w${n} skipped`;
      if (started) { total++; if (!dirs.includes(dir)) dirs.push(dir); return `w${n} running`; }
      if (n === 1) { total++; return 'w1 todo'; }
      return null;
    }).filter(Boolean);
    per.push(`  ${rec.name} (${rec.tier}): ${marks.join(', ')}`);
  }
  lines.push(`waves done: ${done}/${total}`, ...per);
  const cr = creditsFile(dirs);
  lines.push(`runs logged: ${cr.runs}  credits so far: ${Math.round(cr.total)}`);
  return lines.join('\n');
}

// ---- the real runner ----

/** Spawns bench.js with a scratch HOME and a TMPDIR whose path has no "bench" in it; both are removed afterwards. */
function makeExec({ cwd, env = process.env, nodeBin = process.execPath, timeoutSec = 0 } = {}) {
  let current = null;
  const exec = async ({ argv, logFile }) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-home.'));
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'xq.'));
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const log = fs.openSync(logFile, 'a');
    try {
      const code = await new Promise((resolve) => {
        const child = spawn(nodeBin, [BENCH_JS, ...argv], { cwd, stdio: ['ignore', log, log], env: { ...env, HOME: home, TMPDIR: tmpdir } });
        current = child;
        const timer = timeoutSec ? setTimeout(() => child.kill('SIGTERM'), timeoutSec * 1000) : null;
        child.on('exit', (c, sig) => { if (timer) clearTimeout(timer); resolve(c ?? (sig ? 128 : 1)); });
        child.on('error', () => resolve(127));
      });
      return { code };
    } finally {
      current = null;
      fs.closeSync(log);
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
  };
  exec.terminate = () => current?.kill('SIGTERM');
  return exec;
}

module.exports = { initStudy, loadStudy, runStudy, decideStudy, studyStatus, makeExec, paths, runArgv, judgeArgv, STUDY_FILE };
