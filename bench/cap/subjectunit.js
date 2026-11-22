// SPDX-License-Identifier: Apache-2.0
'use strict';

// The subject of a keep-or-prune check is the whole loaded unit of one skill, not its SKILL.md alone: skills move
// their operative rules into references/ and ship scripts, so a reference-only edit must make old work stale.
//
// The canonical subject manifest of skill <name>, with paths relative to the skills/ folder:
//   1. <name>/SKILL.md;
//   2. every other regular file in <name>/ (references, scripts, templates, any executable), except evals/, which
//      holds bench data the agent never loads;
//   3. every file of another skill that SKILL.md names as <other>/references/<file> or <other>/scripts/<file>
//      (a shared reference: "skills install side by side").
// A path SKILL.md names under references/ or scripts/ that does not exist is listed as unresolved and is part of the
// hash, so the day it appears the unit changes. A symbolic link is refused: what it points at is not in the unit.
// The hash is SHA-256 over one line per entry, sorted by path: "<path>\t<x or ->\t<sha256 of the bytes>", or
// "<path>\tmissing" for an unresolved one. The x marks an execute bit, because a script that loses it behaves
// differently.
//
// This module also says what kind a name is (skill, agent, SOP, context) and refuses every kind but skill: the
// keep-or-prune design changes one skill between two arms, and has no harness, baseline or verdict language for the
// others.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKIPPED_DIRS = new Set(['evals']);
/** A path SKILL.md names below references/ or scripts/, with an optional leading <skill>/ (or skills/<skill>/). */
const DECLARED = /(?<![A-Za-z0-9_./-])(?:skills\/)?(?:([a-z0-9][a-z0-9-]*)\/)?((?:references|scripts)\/[A-Za-z0-9_./-]*[A-Za-z0-9_])/g;

const { sha256 } = require('../runner/lib/util.js');

/** Why each kind other than a skill is refused, as the message names it. */
// Stage 1 (this design) measures skills; stages 2 to 4 (agent files, SOPs, context) are `cap unit-stage` (unitstage.js).
const STAGES_2_TO_4 = 'stages 2 to 4 check it with cap unit-stage';
const REFUSED_KINDS = Object.freeze({
  agent: `an agent changes role, tools and model, not one loaded text; keep-or-prune measures skills only (${STAGES_2_TO_4})`,
  sop: `a SOP is a user-invoked prompt, not a skill the agent selects; keep-or-prune measures skills only (${STAGES_2_TO_4})`,
  context: `always-loaded context is in both arms of every run, so it is not ablatable by this design (${STAGES_2_TO_4}, which drops it from one arm)`,
  steering: 'always-loaded steering is in both arms of every run, so it is not ablatable by this design',
});
const KIND_NAMES = Object.freeze({ agent: 'an agent', sop: 'a SOP', context: 'a context file', steering: 'a steering file' });
/** Where each kind lives below the repository root (as in scan.js), plus steering. */
const KIND_PATHS = Object.freeze({
  agent: (n) => [`agents/${n}.agent-spec.json`],
  sop: (n) => [`agent-sops/${n}.sop.md`],
  context: (n) => [`context/${n}.md`],
  steering: (n) => [`.kiro/steering/${n}.md`, `steering/${n}.md`],
});

/**
 * One entry of the unit: { path, exec, sha256 }, or { path, missing: true } when the file is not there.
 * @param {string} skillsDir the skills/ folder
 * @param {string} rel a path below it
 */
function entryOf(skillsDir, rel) {
  const file = path.join(skillsDir, rel);
  let st;
  try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return { path: rel, missing: true }; throw e; }
  if (st.isSymbolicLink()) throw new Error(`${rel} is a symbolic link; the loaded unit holds regular files only`);
  if (!st.isFile()) return { path: rel, missing: true };
  return { path: rel, exec: (st.mode & 0o111) !== 0, sha256: sha256(fs.readFileSync(file)) };
}

/** The files below `dir` (relative to `skillsDir`), in name order, skipping SKIPPED_DIRS at the top of the skill. */
function filesBelow(skillsDir, dir, top = true) {
  const out = [];
  for (const e of fs.readdirSync(path.join(skillsDir, dir), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = `${dir}/${e.name}`;
    if (e.isSymbolicLink()) throw new Error(`${rel} is a symbolic link; the loaded unit holds regular files only`);
    if (e.isDirectory()) { if (!(top && SKIPPED_DIRS.has(e.name))) out.push(...filesBelow(skillsDir, rel, false)); } else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * The paths SKILL.md names below references/ or scripts/, resolved against the skills folder: its own folder unless
 * the path starts with another skill's name. Returns a sorted, de-duplicated list.
 * @param {string} text the SKILL.md text
 * @param {string} name the skill
 * @param {string} skillsDir the skills/ folder, to tell another skill's name from a word
 */
function declaredPaths(text, name, skillsDir) {
  const out = new Set();
  for (const m of text.matchAll(DECLARED)) {
    const [, owner, rest] = m;
    const other = owner && owner !== name && fs.existsSync(path.join(skillsDir, owner, 'SKILL.md'));
    out.add(`${other ? owner : name}/${rest}`);
  }
  return [...out].sort();
}

/**
 * The canonical subject manifest of one skill.
 * @param {object} o
 * @param {string} o.skillsDir the skills/ folder of the tree under test
 * @param {string} o.name the skill
 * @returns {{ name: string, sha256: string, paths: string[], unresolved: string[], entries: object[] }} `paths` are
 *   the files present, `unresolved` the declared paths that are not. Throws when the skill has no SKILL.md.
 */
function subjectManifest({ skillsDir, name }) {
  const skillMd = `${name}/SKILL.md`;
  if (!fs.existsSync(path.join(skillsDir, skillMd))) throw new Error(`no skill named ${name}: ${path.join(skillsDir, skillMd)} does not exist`);
  const text = fs.readFileSync(path.join(skillsDir, skillMd), 'utf8');
  const rels = new Set([...filesBelow(skillsDir, name), ...declaredPaths(text, name, skillsDir)]);
  const entries = [...rels].sort().map((rel) => entryOf(skillsDir, rel));
  const lines = entries.map((e) => (e.missing ? `${e.path}\tmissing` : `${e.path}\t${e.exec ? 'x' : '-'}\t${e.sha256}`));
  return {
    name, sha256: sha256(lines.join('\n')),
    paths: entries.filter((e) => !e.missing).map((e) => e.path),
    unresolved: entries.filter((e) => e.missing).map((e) => e.path),
    entries,
  };
}

/**
 * Where the unit came from in Git: { commit, tree, dirty }. `tree` is the Git tree of skills/<name> at the commit;
 * `dirty` is true when a unit path differs from the commit, so the commit alone does not name the bytes. All fields
 * are null when `repo` is not a Git work tree.
 * @param {object} o
 * @param {string} o.repo the repository root
 * @param {string} o.name the skill
 * @param {string[]} [o.paths] the unit's paths below skills/, for the dirty check (default: the skill folder)
 */
function subjectSource({ repo, name, paths = [name] }) {
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  if (head.status !== 0) return { commit: null, tree: null, dirty: null };
  const tree = git('rev-parse', `HEAD:skills/${name}`);
  const status = git('status', '--porcelain', '--', ...paths.map((p) => `skills/${p}`));
  return { commit: head.stdout.trim(), tree: tree.status === 0 ? tree.stdout.trim() : null, dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}

/**
 * The kinds a name has in a tree (a name may be a skill and a SOP at once).
 * @param {object} o
 * @param {string} o.repo the repository root
 * @param {string} o.name the name to look up
 * @returns {string[]} e.g. ['skill'] or ['agent']; empty when the tree has nothing of that name
 */
function kindsOf({ repo, name }) {
  const kinds = fs.existsSync(path.join(repo, 'skills', name, 'SKILL.md')) ? ['skill'] : [];
  for (const [kind, paths] of Object.entries(KIND_PATHS)) if (paths(name).some((p) => fs.existsSync(path.join(repo, p)))) kinds.push(kind);
  return kinds;
}

/**
 * Throws a clear message unless `name` is a skill in `repo`. A name that is only an agent, SOP, context or steering
 * file is refused with the reason for its kind; a name the tree does not have is refused as unknown. A caller that
 * knows the name was renamed or folded (an identity entry) checks that before calling this.
 * @param {object} o
 * @param {string} o.repo the repository root
 * @param {string} o.name the subject name
 */
function assertSkillSubject({ repo, name }) {
  const kinds = kindsOf({ repo, name });
  if (kinds.includes('skill')) return;
  if (!kinds.length) throw new Error(`${name} is not a skill in ${repo} (no skills/${name}/SKILL.md, and no identity entry maps it to one)`);
  throw new Error(`${name} is ${KIND_NAMES[kinds[0]]}, not a skill: ${REFUSED_KINDS[kinds[0]]}`);
}

module.exports = { REFUSED_KINDS, SKIPPED_DIRS, declaredPaths, subjectManifest, subjectSource, kindsOf, assertSkillSubject };
