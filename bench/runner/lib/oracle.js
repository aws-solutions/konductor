// SPDX-License-Identifier: Apache-2.0
'use strict';

// Oracle arm: `run --oracle-skills [ARM,ARM]` puts the SKILL.md bodies a task is expected to use in front of its prompt, so a
// run can tell "the skill was not loaded" from "the skill adds nothing". The expected skills come from a task manifest
// (suites/rootcause.manifest.json, tasks[].entries[].expectedSkills) and the bodies from the arm's own ref. Konductor arms
// only; vanilla is refused. Everything is resolved and checked before any run starts, so a typo costs nothing.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MAX_PREFIX_BYTES } = require('./arm-opts.js');

const SKILL_RE = /^[a-z0-9][a-z0-9-]*$/;
const BEGIN = '=== BEGIN ORACLE SKILLS (added by the benchmark; follow them where they apply) ===';
const END = '=== END ORACLE SKILLS ===';

function loadManifest(file) {
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`--oracle-manifest: cannot read ${file}: ${e.code || e.message}`); }
  if (!Array.isArray(m.tasks)) throw new Error(`--oracle-manifest: ${file} has no tasks[] list`);
  return new Map(m.tasks.map((t) => [t.id, t.entries ?? []]));
}

/** Arms the option applies to: `true` is every non-vanilla arm, a list names them. Vanilla and unknown names are errors. */
function targetArms(value, arms) {
  if (value === undefined || value === false) return [];
  const real = arms.filter((a) => !a.vanilla);
  if (value === true) {
    if (!real.length) throw new Error('--oracle-skills: every arm is vanilla, and vanilla has no skills to inject');
    return real;
  }
  const out = [];
  for (const name of String(value).split(',').filter(Boolean)) {
    const arm = arms.find((a) => a.id === name);
    if (!arm) throw new Error(`--oracle-skills: arm "${name}" is not among --arms (${arms.map((a) => a.id).join(', ')})`);
    if (arm.vanilla) throw new Error(`--oracle-skills: arm "${name}" is vanilla; the oracle is for konductor arms only`);
    out.push(arm);
  }
  if (!out.length) throw new Error('--oracle-skills takes no value (every konductor arm) or ARM[,ARM]');
  return out;
}

/** Skills the manifest expects for this task and entry agent. An entry for another agent is not used; with none matching, the union of the task's entries is. */
function expectedFor(entries, agent) {
  const mine = entries.filter((e) => e.agent === agent);
  const used = mine.length ? mine : entries;
  return { skills: [...new Set(used.flatMap((e) => e.expectedSkills ?? []))], entryMatched: mine.length > 0 };
}

function readSkill(arm, repo, name) {
  if (!SKILL_RE.test(name)) throw new Error(`skill name "${name}" is not a valid skill name`);
  try {
    if (arm.source === 'dir' && arm.dir) return fs.readFileSync(path.join(arm.dir, 'skills', name, 'SKILL.md'), 'utf8');
    return execFileSync('git', ['-C', repo, 'show', `${arm.commitSha}:skills/${name}/SKILL.md`], { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
}

/** SKILL.md without its frontmatter. */
const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s+/, '');

function renderBlock(parts) {
  const skills = parts.map((p) => `--- SKILL: ${p.name} ---\n${p.body.replace(/\s+$/, '')}\n--- END SKILL: ${p.name} ---`);
  return `${BEGIN}\n\n${skills.join('\n\n')}\n\n${END}`;
}

/**
 * Resolves and validates the oracle for every (arm, task) pair and stores it on the arm as `arm.oracle` (a Map of task id to
 * { skills, entryMatched, block, bytes, sha256 }). Throws, naming every problem at once, before any run starts.
 */
function applyOracle(arms, opts, { tasks, repo, benchDir }) {
  const value = opts['oracle-skills'];
  const targets = targetArms(value, arms);
  if (!targets.length) {
    if (opts['oracle-manifest'] !== undefined) throw new Error('--oracle-manifest needs --oracle-skills');
    return {};
  }
  const manifestFile = opts['oracle-manifest'] && opts['oracle-manifest'] !== true ? path.resolve(opts['oracle-manifest']) : path.join(benchDir, 'suites', 'rootcause.manifest.json');
  const manifest = loadManifest(manifestFile);
  const problems = [];
  const record = {};
  for (const arm of targets) {
    const byTask = new Map();
    for (const task of tasks) {
      const entries = manifest.get(task.id);
      if (!entries) { problems.push(`task ${task.id} has no entry in ${path.basename(manifestFile)}`); continue; }
      const { skills, entryMatched } = expectedFor(entries, arm.agent);
      if (!skills.length) { problems.push(`task ${task.id} lists no expected skills for ${arm.agent}`); continue; }
      const parts = [];
      for (const name of skills) {
        const text = readSkill(arm, repo, name);
        if (text == null) problems.push(`arm ${arm.id}, task ${task.id}: skill "${name}" has no skills/${name}/SKILL.md in ${arm.ref}`);
        else parts.push({ name, body: bodyOf(text) });
      }
      if (parts.length !== skills.length) continue;
      const block = renderBlock(parts);
      const bytes = Buffer.byteLength(block);
      if (bytes + (arm.prefixInfo?.bytes ?? 0) > MAX_PREFIX_BYTES) { problems.push(`arm ${arm.id}, task ${task.id}: the oracle block is ${bytes} bytes, over the ${MAX_PREFIX_BYTES} byte limit shared with the prefix`); continue; }
      byTask.set(task.id, { skills, entryMatched, block, bytes, sha256: crypto.createHash('sha256').update(block).digest('hex') });
    }
    arm.oracle = byTask;
    record[arm.id] = { manifest: path.basename(manifestFile), tasks: Object.fromEntries([...byTask].map(([id, o]) => [id, { skills: o.skills, bytes: o.bytes, sha256: o.sha256 }])) };
  }
  if (problems.length) throw new Error(`--oracle-skills refused (${problems.length} problem(s)), nothing was run:\n- ${problems.join('\n- ')}`);
  return record;
}

/** What result.json records for one run, or null for an arm or task without an oracle. */
function oracleResult(arm, task) {
  const o = arm?.oracle?.get(task.id);
  return o ? { skills: o.skills, entryMatched: o.entryMatched, bytes: o.bytes, sha256: o.sha256 } : null;
}

module.exports = { applyOracle, oracleResult, targetArms, expectedFor, bodyOf, renderBlock, BEGIN, END };
