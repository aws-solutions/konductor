// SPDX-License-Identifier: Apache-2.0
'use strict';

// Run profiles: bench/profiles/quick.json and detailed.json, chosen with --profile. A profile sets how much
// evidence a study collects (replicates, A/A arm, controls, judge modes, calibration sample); it does not change how
// anything is scored. scoring.json holds the score weights and is not a profile.

const fs = require('node:fs');
const path = require('node:path');
const { BENCH_DIR } = require('./tasks.js');
const { drawSample } = require('../../judge/calibrate.js');

const PROFILE_NAMES = ['quick', 'detailed'];
const MODES = ['rubric', 'pairwise', 'graded'];
const DETAILS = ['quick', 'full'];
const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const ARM_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/;

const isCount = (v) => Number.isInteger(v) && v >= 1;

function checkProfile(p, file) {
  const bad = (what) => { throw new Error(`profile ${file}: ${what}`); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) bad('must be a JSON object');
  const r = p.replicates;
  if (!r || !isCount(r.default) || !isCount(r.min)) bad('replicates needs whole numbers default and min of at least 1');
  if (r.max !== undefined && !isCount(r.max)) bad('replicates.max must be a whole number of at least 1');
  if (r.default < r.min || (r.max !== undefined && (r.default > r.max || r.min > r.max))) bad('replicates.default must lie between min and max');
  for (const k of ['aaArm', 'controls']) if (typeof p[k] !== 'boolean') bad(`${k} must be true or false`);
  if (!p.scenariosPerSkill || !isCount(p.scenariosPerSkill.min)) bad('scenariosPerSkill.min must be a whole number of at least 1');
  const j = p.judging;
  if (!j || !Array.isArray(j.modes) || !j.modes.length || j.modes.some((m) => !MODES.includes(m))) bad(`judging.modes must list some of ${MODES.join(', ')}`);
  if (typeof j.bothOrders !== 'boolean') bad('judging.bothOrders must be true or false');
  if (!Number.isInteger(p.calibrationSample) || p.calibrationSample < 0) bad('calibrationSample must be a whole number of 0 or more');
  if (!p.report || !DETAILS.includes(p.report.detail)) bad(`report.detail must be ${DETAILS.join(' or ')}`);
  if (!isCount(p.anecdotalBelow)) bad('anecdotalBelow must be a whole number of at least 1');
  return p;
}

/** The profile named `name`, read from <benchDir>/profiles/<name>.json and checked. */
function loadProfile(name, { benchDir = BENCH_DIR } = {}) {
  if (!PROFILE_NAMES.includes(name)) throw new Error(`--profile takes ${PROFILE_NAMES.join(' or ')} (got ${JSON.stringify(name)})`);
  const file = path.join(benchDir, 'profiles', `${name}.json`);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`profile ${file}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`); }
  return checkProfile(data, file);
}

/** null when --profile was not given, else the loaded profile. A bare `--profile` is an error. */
function optionalProfile(value, opts) {
  if (value === undefined) return null;
  if (value === true) throw new Error(`--profile takes ${PROFILE_NAMES.join(' or ')}`);
  return loadProfile(value, opts);
}

/**
 * Replicates per cell under a profile: the profile's default when none was asked for, the asked-for value when it is
 * in range, an error when it is not. Without a profile the value passes through (undefined stays undefined).
 */
function replicatesFor(profile, requested) {
  if (requested === undefined) return profile ? profile.replicates.default : undefined;
  const n = Number(requested);
  if (!Number.isInteger(n) || n < 1) throw new Error('--replicates must be an integer >= 1');
  if (!profile) return n;
  const { min, max } = profile.replicates;
  if (n < min) throw new Error(`profile ${profile.name} needs at least ${min} replicates per cell (got ${n}); use --profile quick for a smaller run`);
  if (max !== undefined && n > max) throw new Error(`profile ${profile.name} allows ${min} to ${max} replicates (got ${n}); use --profile detailed for more`);
  return n;
}

// Same ref and same konductor config: a different --arm-config is a different condition, not a repeat.
const identityOf = (a) => {
  const ref = a.commitSha || a.contentHash || null;
  return ref && a.armConfig ? `${ref}|${JSON.stringify(a.armConfig)}` : ref;
};
const unprefixed = (id) => id.replace(/^oc-/, '');

/**
 * The extra arm that gives a study its noise floor: the first non-vanilla arm repeated at the same exact commit (or
 * directory snapshot). `arms` are resolved arms. Returns { spec, twin, note }; spec is null when no arm is needed.
 */
function aaArmFor(arms) {
  const real = arms.filter((a) => !a.vanilla);
  if (!real.length) return { spec: null, twin: null, note: 'no A/A arm: every arm is vanilla, so there is no ref to repeat' };
  const seen = new Set();
  for (const a of real) {
    const id = identityOf(a);
    if (id && seen.has(id)) return { spec: null, twin: null, note: `the arm list already has an A/A pair (${real.filter((x) => identityOf(x) === id).map((x) => x.id).join(' and ')} are the same ref)` };
    if (id) seen.add(id);
  }
  const twin = real[0];
  const taken = new Set(arms.map((a) => a.id));
  const prefix = twin.runtime === 'opencode' ? 'oc-' : '';
  const stem = unprefixed(twin.id);
  let name = null;
  for (const suffix of 'bcdefgh') {
    const candidate = `${stem}-${suffix}`;
    if (ARM_NAME_RE.test(candidate) && !taken.has(`${prefix}${candidate}`)) { name = candidate; break; }
  }
  if (!name) return { spec: null, twin: twin.id, note: `no A/A arm: no free name for a repeat of ${twin.id}` };
  const target = twin.source === 'dir' ? `dir:${twin.dir}` : twin.commitSha;
  const where = twin.source === 'dir' ? `directory snapshot ${String(twin.contentHash).slice(0, 7)}` : String(twin.commitSha).slice(0, 7);
  return { spec: `${prefix}${name}=${target}`, twin: twin.id, note: `A/A arm ${prefix}${name} repeats ${twin.id} at ${where}: the gap between the two is the run-to-run noise` };
}

/**
 * What a finished study still lacks against its profile. `facts` is the diligence facts object of the run and
 * `judgments` the parsed judgments.json (or null). Quick has one item: fewer replicates than anecdotalBelow is anecdotal.
 */
function profileCheck(profile, { facts, judgments }) {
  const items = [];
  const add = (ok, text) => items.push({ ok, text });
  const rep = facts.replicates.min;
  if (profile.name === 'quick' || profile.replicates.min < profile.anecdotalBelow) {
    add(rep >= profile.anecdotalBelow, rep >= profile.anecdotalBelow ? `${rep} replicates per cell` : `${rep} replicates per cell: results are anecdotal (under ${profile.anecdotalBelow})`);
    return { met: items.every((i) => i.ok), items };
  }
  add(rep >= profile.replicates.min, `${rep} replicates per cell, the profile needs ${profile.replicates.min}`);
  if (profile.aaArm && facts.study.comparison) add(Boolean(facts.aaArms || facts.sameRefRepeat), facts.aaArms || facts.sameRefRepeat ? 'an A/A arm or same-ref repeat is present' : 'no A/A arm or same-ref repeat, so there is no noise floor');
  if (profile.controls && facts.study.capability) {
    const c = facts.controls;
    add(c.positive > 0 && c.negative > 0, `known-answer controls: ${c.positive} keep, ${c.negative} prune`);
  }
  if (!facts.judging.present || !judgments) add(false, 'not judged: no judgments.json');
  else {
    if ((facts.judging.backends || []).length > 1) add(false, `judge backend: results were judged on different backends (${facts.judging.backends.join(', ')}), and their verdicts are not comparable`);
    for (const m of profile.judging.modes) add((judgments.modes || []).includes(m), `${m} judging ${(judgments.modes || []).includes(m) ? 'was run' : 'was not run'}`);
    if (profile.judging.bothOrders) {
      const pw = facts.judging.pairwise;
      if (pw.run) add(pw.records > 0 && pw.bothOrders === pw.records, `pairwise in both answer orders: ${pw.bothOrders} of ${pw.records}`);
      const gr = (judgments.graded || []);
      if (gr.length) add(gr.every((g) => Array.isArray(g.orderings) && g.orderings.every(Boolean)), `graded in both answer orders: ${gr.filter((g) => Array.isArray(g.orderings) && g.orderings.every(Boolean)).length} of ${gr.length}`);
    }
  }
  if (profile.calibrationSample > 0) add(Boolean(facts.calibration), facts.calibration ? `human calibration kappa ${facts.calibration.kappa.toFixed(2)}` : 'no human calibration result (label calibration-sample.md, then calibrate score --save)');
  return { met: items.every((i) => i.ok), items };
}

/** The runs a human labels to calibrate the judges: the draw `calibrate export` makes for the same n and seed. */
function calibrationSample({ run, n, seed }) {
  const picked = drawSample(run.runs, n, seed);
  return { runDir: run.dir, n, seed, items: picked.map((r) => ({ armId: r.armId, taskId: r.taskId, replicate: r.replicate })) };
}

/** Writes calibration-sample.json and .md into the results directory. Null (and no file) when n is 0. */
function writeCalibrationSample({ run, n, seed }) {
  if (!n) return null;
  const sample = calibrationSample({ run, n, seed });
  const json = path.join(run.dir, 'calibration-sample.json');
  const md = path.join(run.dir, 'calibration-sample.md');
  const command = `node ${BENCH_JS} calibrate export --run ${run.dir} --n ${n} --seed ${seed}`;
  fs.writeFileSync(json, `${JSON.stringify({ schemaVersion: 1, ...sample, exportCommand: command }, null, 2)}\n`);
  const lines = [
    '# Human calibration sample', '',
    `${sample.items.length} run(s) for a person to label, so the judges can be checked against a human (kappa at least 0.6 is the bar). Seed ${seed}.`,
    'Do not show this file to the person labelling: it names the arm of each run. Give them the blinded sheet instead.', '',
    'Make the blinded sheet (it draws exactly these runs):', '', '```', command, '```', '',
    `Then fill in sheet.json and run \`calibrate score --labels ${path.join(run.dir, 'calibration', 'sheet.json')} --save ${path.join(run.dir, 'calibration', 'result.json')}\`. The report reads result.json.`, '',
    '| # | arm | task | replicate |', '|---|---|---|---|',
    ...sample.items.map((i, k) => `| ${k + 1} | ${i.armId} | ${i.taskId} | ${i.replicate} |`), '',
  ];
  fs.writeFileSync(md, lines.join('\n'));
  return { json, md, items: sample.items.length };
}

module.exports = {
  PROFILE_NAMES, loadProfile, optionalProfile, replicatesFor, aaArmFor, calibrationSample, writeCalibrationSample, checkProfile, profileCheck,
};
