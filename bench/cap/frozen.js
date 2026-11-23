// SPDX-License-Identifier: Apache-2.0
'use strict';

// The frozen inputs of a keep-or-prune check: a skill's baseline (the 35 copied from Michael Lin's bench/baselines,
// commit 33b385f9, pull requests #268 to #271), the convention-control skill and the dose ladder (pull requests #266
// and #251), all under bench/cap. Before any baseline is read, the whole baselines folder is checked by
// baselineverify.js (manifest membership, file names, formats, cross-file and rules-to-task hashes, secret shapes,
// provenance and identities); one problem anywhere refuses every baseline. JSON is read with the checked reader, so a
// repeated key is refused.
//
// Freshness is judged on the whole loaded unit (subjectunit.js), not SKILL.md alone:
//   - a baseline whose rules.json has `source` is fresh when its recorded subject manifest hash equals today's;
//   - a legacy baseline (his format: SKILL.md hash only) is fresh only when SKILL.md is byte-identical AND today's unit
//     is SKILL.md alone, because then nothing it did not hash can have changed.
// A stale or renamed/folded subject gets `staleWhy` / `identityWhy`; the check turns them into NO DATA reasons.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadLadder, validateLadder } = require('./doseladder.js');
const { readJsonFile } = require('./checkedjson.js');
const { verifyBaselines, MANIFEST_NAME } = require('./baselineverify.js');
const { subjectManifest } = require('./subjectunit.js');

const CAP_DIR = __dirname;
const BASELINES_DIR = path.join(CAP_DIR, 'baselines');
const CONTROLS_DIR = path.join(CAP_DIR, 'controls');
const CONVENTION = 'convention-control';
const TASKS_FILE = /^tasks-(.+)\.json$/;

const { sha256 } = require('../runner/lib/util.js');
const short = (h) => (h ? h.slice(0, 12) : 'none');

/** The batches of the tasks files in `dir` (tasks-<batch>.json, not the .buckets sidecars), in name order. */
function batchesIn(dir) {
  return fs.readdirSync(dir).filter((f) => TASKS_FILE.test(f) && !f.endsWith('.buckets.json')).sort().map((f) => taskBatch(readJsonFile(path.join(dir, f))));
}
/** A tasks file as a batch: { batch, tasks: [{ id, prompt, rubric }] }. */
const taskBatch = (t) => ({ batch: t.batch, tasks: t.scenarios.map((s) => ({ id: s.id, prompt: s.prompt, rubric: [...s.rubric] })) });

/**
 * Whether a baseline's rules still describe today's loaded unit.
 * @param {object} rules the checked rules.json
 * @param {object} unit today's subjectManifest
 * @param {string} skillSha the sha256 of today's SKILL.md
 * @returns {{ fresh: boolean, legacy: boolean, recordedSha256: string|null, why: string|null }}
 */
function unitFreshness(rules, unit, skillSha) {
  const recorded = rules.source?.subject ?? null;
  if (recorded) {
    if (recorded.sha256 === unit.sha256) return { fresh: true, legacy: false, recordedSha256: recorded.sha256, why: null };
    const added = unit.paths.filter((p) => !recorded.paths.includes(p));
    const gone = recorded.paths.filter((p) => !unit.paths.includes(p));
    const detail = [added.length ? `added ${added.join(', ')}` : '', gone.length ? `removed ${gone.join(', ')}` : ''].filter(Boolean).join('; ') || `a listed file changed (${recorded.paths.join(', ')})`;
    return { fresh: false, legacy: false, recordedSha256: recorded.sha256, why: `the loaded unit changed after the baseline was frozen (subject ${short(recorded.sha256)}, now ${short(unit.sha256)}: ${detail})` };
  }
  const extra = [...unit.paths.filter((p) => p !== `${unit.name}/SKILL.md`), ...unit.unresolved];
  if (rules.skill_md_sha256 !== skillSha) return { fresh: false, legacy: true, recordedSha256: null, why: `SKILL.md changed after the baseline's rules were written (rules ${short(rules.skill_md_sha256)}, now ${short(skillSha)})` };
  if (extra.length) return { fresh: false, legacy: true, recordedSha256: null, why: `the legacy baseline hashed SKILL.md only, and the skill now loads ${extra.join(', ')}` };
  return { fresh: true, legacy: true, recordedSha256: null, why: null };
}

/**
 * Verifies the baselines folder and throws when anything is wrong. Returns verifyBaselines' result.
 * @param {string} dir the baselines folder
 * @param {string} skillsDir the skills/ folder of the tree under test
 */
function verifiedBaselines(dir, skillsDir) {
  const v = verifyBaselines({ dir, skillsDir });
  if (v.problems.length) throw new Error(`the frozen baselines in ${dir} fail their check (${v.problems.length} problem(s)): ${v.problems.slice(0, 3).join('; ')}`);
  return v;
}

/** The identities entry of `name` when it says the skill was removed with no successor, else null. */
const removedIdentity = (manifest, name) => (manifest.identities?.[name]?.how === 'removed' ? manifest.identities[name] : null);

/**
 * The freshness of one baseline against a tree, with its identity. `b` is a verified readSkillBaseline result.
 * Returns { name, unitName, identity, identityWhy, unit, skillText, skillSha, freshness }.
 */
function statusOf(b, manifest, skillsDir) {
  const identity = manifest.identities?.[b.skill] ?? null;
  const unitName = identity ? identity.replaced_by : b.skill;
  const skillText = fs.readFileSync(path.join(skillsDir, unitName, 'SKILL.md'), 'utf8');
  const skillSha = sha256(skillText);
  const unit = subjectManifest({ skillsDir, name: unitName });
  const approved = identity && identity.migration.approved_by;
  const identityWhy = identity && !approved ? `${b.skill} was ${identity.how} into ${identity.replaced_by}; its old tasks and rule quotes do not establish equivalence, so it is NO DATA until a person approves a migration (${MANIFEST_NAME} identities.${b.skill}.migration)` : null;
  return { name: b.skill, unitName, identity, identityWhy, unit, skillText, skillSha, freshness: unitFreshness(b.rules, unit, skillSha) };
}

/**
 * A skill's frozen baseline, after the whole folder passes its check.
 * @param {object} o
 * @param {string} o.name the skill (or the old name of a renamed or folded skill)
 * @param {string} o.skillsDir the skills/ folder of the tree under test
 * @param {string} [o.dir] the baselines folder (default bench/cap/baselines)
 * @returns {object} { name, skill: { name, text, sha256 }, unit, batches, bWaiting, staleWhy, identity, identityWhy,
 *   recorded: { legacy, unitSha256, source }, selection, manifestSha256 }. `unit` is today's subject manifest;
 *   `bWaiting` lists batches whose reading B waits (stale rules or tasks); `selection` is { set, sha256 } for a frozen
 *   selection.json, or null.
 */
function loadBaseline({ name, skillsDir, dir = BASELINES_DIR }) {
  const v = verifiedBaselines(dir, skillsDir);
  const b = v.skills.get(name);
  if (!b || !b.hasBaseline) throw new Error(`no frozen baseline for ${name} in ${dir}`);
  const gone = removedIdentity(v.manifest, name);
  if (gone) throw new Error(`${name} was removed from the tree, so there is nothing to measure: ${gone.note}`);
  const s = statusOf(b, v.manifest, skillsDir);
  const batches = b.batches.map((x) => taskBatch(x.tasks));
  const bWaiting = b.batches.filter((x) => b.rulesStale || x.stale).map((x) => x.batch);
  return {
    name, skill: { name: s.unitName, text: s.skillText, sha256: s.skillSha }, unit: s.unit, batches, bWaiting,
    staleWhy: s.freshness.why, identity: s.identity, identityWhy: s.identityWhy,
    recorded: { legacy: s.freshness.legacy, unitSha256: s.freshness.recordedSha256, source: b.rules.source ? { commit: b.rules.source.commit, tree: b.rules.source.tree } : null },
    selection: b.selection ? { set: b.selection, sha256: sha256(fs.readFileSync(path.join(dir, name, 'selection.json'))) } : null,
    manifestSha256: sha256(fs.readFileSync(path.join(dir, MANIFEST_NAME))),
  };
}

/**
 * The freshness of every frozen baseline against a tree: [{ skill, status, why }], status fresh, stale, renamed,
 * folded or removed. Throws when the folder fails its check.
 * @param {object} o
 * @param {string} o.skillsDir the skills/ folder of the tree under test
 * @param {string} [o.dir] the baselines folder
 */
function baselineStatus({ skillsDir, dir = BASELINES_DIR }) {
  const v = verifiedBaselines(dir, skillsDir);
  return [...v.skills.values()].map((b) => {
    const gone = removedIdentity(v.manifest, b.skill);
    if (gone) return { skill: b.skill, status: 'removed', why: gone.note };
    const s = statusOf(b, v.manifest, skillsDir);
    if (s.identity) return { skill: b.skill, status: s.identity.how, why: s.identityWhy ?? s.freshness.why };
    return { skill: b.skill, status: s.freshness.fresh ? 'fresh' : 'stale', why: s.freshness.why };
  });
}

/** The convention-control subject: its SKILL.md and its one batch of tasks. `dir` is its folder. */
function loadConvention(dir = path.join(CONTROLS_DIR, CONVENTION)) {
  const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  return { name: CONVENTION, skill: { name: CONVENTION, text, sha256: sha256(text) }, batches: batchesIn(dir), bWaiting: [] };
}

/**
 * The sentence every convention control task carries, so both arms take the request's dates and facts as given and
 * neither writes placeholders (the control skill's guard rule asks the same of the with arm only).
 */
const CONTROL_AS_GIVEN = 'Take the dates and facts in this request as given: they are correct, so use them as they are, with no placeholders.';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_DATE = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')}) (\\d{4})\\b`, 'g');

/**
 * The full dates (`3 November 2026`) in the tasks of `convention` that are before the day of `now`: [{ task, date }].
 * A date gone stale makes the control's without arm hedge about it, which moves reading A (pilot kp-pilot-1). A month
 * with no day ("since March 2024") is history the task means as past, and is not read.
 */
function pastControlDates(convention, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const past = [];
  for (const b of convention.batches) {
    for (const t of b.tasks) {
      for (const m of t.prompt.matchAll(DAY_DATE)) {
        if (Date.UTC(Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])) < today) past.push({ task: t.id, date: m[0] });
      }
    }
  }
  return past;
}

/** The dose ladder at `file`, refused when it fails its own audit or repeats a key. */
function loadDoseLadder(file = path.join(CONTROLS_DIR, 'dose-ladder-v1.json')) {
  const ladder = loadLadder(file);
  const audit = validateLadder(ladder);
  if (!audit.ok) throw new Error(`the dose ladder ${file} fails its audit: ${audit.problems.slice(0, 3).join('; ')}`);
  return ladder;
}

module.exports = { BASELINES_DIR, CONTROLS_DIR, CONTROL_AS_GIVEN, unitFreshness, loadBaseline, baselineStatus, loadConvention, loadDoseLadder, pastControlDates };
