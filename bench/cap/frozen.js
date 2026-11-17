// SPDX-License-Identifier: Apache-2.0
'use strict';

// The frozen inputs of a keep-or-prune check: a skill's baseline (copied from Michael Lin's bench/baselines, commit
// 33b385f9, pull requests #268 to #271), the convention-control skill and the dose ladder (pull requests #266 and
// #251), all under bench/cap. Every baseline file is checked against MANIFEST.json, so an edited task is refused, not
// read. A baseline made from another SKILL.md than the one in the repository has a stale reading B: its batches are
// returned in `bWaiting`, and the copied label rules then read A alone.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadLadder, validateLadder } = require('./doseladder.js');

const CAP_DIR = __dirname;
const BASELINES_DIR = path.join(CAP_DIR, 'baselines');
const CONTROLS_DIR = path.join(CAP_DIR, 'controls');
const CONVENTION = 'convention-control';
const TASKS_FILE = /^tasks-(.+)\.json$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** The batches of the tasks files in `dir` (tasks-<batch>.json, not the .buckets sidecars), in name order. */
function batchesIn(dir) {
  return fs.readdirSync(dir).filter((f) => TASKS_FILE.test(f) && !f.endsWith('.buckets.json')).sort().map((f) => {
    const t = readJson(path.join(dir, f));
    return { batch: t.batch, tasks: t.scenarios.map((s) => ({ id: s.id, prompt: s.prompt, rubric: [...s.rubric] })) };
  });
}

/**
 * A skill's frozen baseline. `name` is the skill, `skillFile` its current SKILL.md, `dir` the baselines folder (default
 * bench/cap/baselines). Returns { name, skill: { text, sha256 }, batches, bWaiting, staleWhy, manifestSha256 }.
 * Throws when the skill has no baseline, or a file is missing from the manifest or differs from its hash.
 */
function loadBaseline({ name, skillFile, dir = BASELINES_DIR }) {
  const manifestFile = path.join(dir, 'MANIFEST.json');
  const manifestText = fs.readFileSync(manifestFile);
  const manifest = JSON.parse(manifestText);
  if (manifest.format_version !== 1) throw new Error(`${manifestFile}: format_version ${manifest.format_version} is not 1`);
  const own = path.join(dir, name);
  if (!fs.existsSync(own)) throw new Error(`no frozen baseline for ${name} in ${dir}`);
  for (const f of fs.readdirSync(own)) {
    const rel = `${name}/${f}`;
    const want = manifest.files[rel];
    if (!want) throw new Error(`${rel} is not in ${manifestFile}, so it is not a frozen file`);
    if (sha256(fs.readFileSync(path.join(own, f))) !== want) throw new Error(`${rel} differs from its hash in ${manifestFile}; a frozen task is never edited in place`);
  }
  const rules = readJson(path.join(own, 'rules.json'));
  const text = fs.readFileSync(skillFile, 'utf8');
  const skillSha = sha256(text);
  const batches = batchesIn(own);
  const stale = rules.skill_md_sha256 !== skillSha;
  return {
    name, skill: { name, text, sha256: skillSha }, batches,
    bWaiting: stale ? batches.map((b) => b.batch) : [],
    staleWhy: stale ? `SKILL.md changed after the baseline's rules were written (rules ${rules.skill_md_sha256.slice(0, 12)}, now ${skillSha.slice(0, 12)}), so reading B waits for a refreshed baseline` : null,
    manifestSha256: sha256(manifestText),
  };
}

/** The convention-control subject: its SKILL.md and its one batch of tasks. */
function loadConvention(dir = path.join(CONTROLS_DIR, CONVENTION)) {
  const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  return { name: CONVENTION, skill: { name: CONVENTION, text, sha256: sha256(text) }, batches: batchesIn(dir), bWaiting: [] };
}

/** The dose ladder, refused when it fails its own audit. */
function loadDoseLadder(file = path.join(CONTROLS_DIR, 'dose-ladder-v1.json')) {
  const ladder = loadLadder(file);
  const audit = validateLadder(ladder);
  if (!audit.ok) throw new Error(`the dose ladder ${file} fails its audit: ${audit.problems.slice(0, 3).join('; ')}`);
  return ladder;
}

module.exports = { BASELINES_DIR, CONTROLS_DIR, loadBaseline, loadConvention, loadDoseLadder };
