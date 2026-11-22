// SPDX-License-Identifier: Apache-2.0
'use strict';

// The konductor-forced arm: `run --forced-must-load ARM[,ARM]` puts an instruction in front of each task's prompt that
// names the task's loadCheck.mustLoad units and says to load them before anything else, in the wording of the cap
// forced-load arm (bench/cap/forced.js loadClause). Nothing else changes: same ref, same agents, same skill index. Run
// beside the organic konductor arm at the same ref, it separates "the skill was not loaded" from "the skill adds
// nothing" without pasting the skill text in (the oracle arm does that). Whether each unit really loaded is still read
// from the stream (result.loadCheck). Konductor arms on kiro-cli or opencode only. A task with no mustLoad, or a unit
// the arm's tree does not have, is refused, every problem named at once, before any run starts.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadClause, HARNESSES } = require('../../cap/forced.js');
const { MAX_PREFIX_BYTES } = require('./arm-opts.js');
const { runtimeOf } = require('./harness/runtime.js');

const FLAG = 'forced-must-load';
const UNIT_RE = /^(?:(skill|sop|agent):)?([a-z0-9][a-z0-9._-]*)$/;
const BEGIN = '=== BEGIN FORCED LOAD (added by the benchmark) ===';
const END = '=== END FORCED LOAD ===';

/** Arms the option names. Each must be a konductor arm on a harness the forced wording supports. */
function targetArms(value, arms) {
  if (value === undefined || value === false) return [];
  if (value === true || !String(value).split(',').filter(Boolean).length) throw new Error(`--${FLAG} takes ARM[,ARM], the konductor arms to force`);
  return String(value).split(',').filter(Boolean).map((name) => {
    const arm = arms.find((a) => a.id === name);
    if (!arm) throw new Error(`--${FLAG}: arm "${name}" is not among --arms (${arms.map((a) => a.id).join(', ')})`);
    if (arm.vanilla) throw new Error(`--${FLAG}: arm "${name}" is vanilla, which has no skills to load`);
    if (!HARNESSES.includes(runtimeOf(arm))) throw new Error(`--${FLAG}: arm "${name}" runs on ${runtimeOf(arm)}; forced loads are worded for ${HARNESSES.join(' and ')} only`);
    return arm;
  });
}

/** True when `rel` exists in the arm's tree (its directory, or its commit in `repo`). */
function inTree(arm, repo, rel) {
  if (arm.source === 'dir' && arm.dir) return fs.existsSync(path.join(arm.dir, rel));
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${arm.commitSha}:${rel}`], { stdio: 'ignore' }); return true; } catch { return false; }
}

const PLACES = { skill: (n) => `skills/${n}/SKILL.md`, sop: (n) => `agent-sops/${n}.sop.md`, agent: (n) => `agents/${n}.agent-spec.json` };

/** { name, kind } for one mustLoad entry: its `kind:` prefix, else the first of skill, SOP, agent the tree has. Null kind when none. */
function unitOf(entry, has) {
  const m = UNIT_RE.exec(String(entry).toLowerCase());
  if (!m) return { name: String(entry), kind: null };
  const [, given, name] = m;
  if (given) return { name, kind: has(PLACES[given](name)) ? given : null };
  return { name, kind: ['skill', 'sop', 'agent'].find((k) => has(PLACES[k](name))) ?? null };
}

/** The first-turn block for a task's units: one sentence that loads every skill and SOP in order, then any agent hand-off. */
function renderBlock(units, harness) {
  const loads = units.filter((u) => u.kind !== 'agent').map((u) => loadClause({ ...u, harness }));
  const agents = units.filter((u) => u.kind === 'agent');
  const lines = [];
  if (loads.length) lines.push(`Before you do anything else, ${loads.join('; then ')}.`);
  for (const a of agents) lines.push(`${lines.length ? 'Then' : 'Before you do anything else,'} ${loadClause({ ...a, harness })}.`);
  lines.push(units.length === 1 ? `Then do the task below, following that ${units[0].kind} wherever it applies.` : 'Then do the task below, following each of them wherever it applies.');
  return `${BEGIN}\n${lines.join(' ')}\n${END}`;
}

/**
 * Builds the block for every (arm, task) pair and stores it on the arm as `arm.forcedLoad` (a Map of task id to
 * { units, block, bytes, sha256 }). Returns what run-config records. Throws before any run when anything is missing.
 */
function applyForcedMustLoad(arms, opts, { tasks, repo }) {
  const targets = targetArms(opts[FLAG], arms);
  const problems = [];
  const record = {};
  for (const arm of targets) {
    if (arm.oracle) { problems.push(`arm ${arm.id} also has --oracle-skills; a forced arm names the skills, an oracle arm pastes them, so pick one`); continue; }
    const harness = runtimeOf(arm);
    const byTask = new Map();
    for (const task of tasks) {
      const must = task.loadCheck?.mustLoad;
      if (!Array.isArray(must) || !must.length) { problems.push(`task ${task.id} has no loadCheck.mustLoad, so there is nothing to force`); continue; }
      const units = must.map((e) => unitOf(e, (rel) => inTree(arm, repo, rel)));
      const missing = units.filter((u) => !u.kind);
      if (missing.length) { problems.push(`arm ${arm.id}, task ${task.id}: ${missing.map((u) => `"${u.name}"`).join(', ')} is not a skill, SOP or agent in ${arm.ref}`); continue; }
      const block = renderBlock(units, harness);
      const bytes = Buffer.byteLength(block);
      if (bytes + (arm.prefixInfo?.bytes ?? 0) > MAX_PREFIX_BYTES) { problems.push(`arm ${arm.id}, task ${task.id}: the forced block and prefix are over ${MAX_PREFIX_BYTES} bytes`); continue; }
      byTask.set(task.id, { units: units.map((u) => `${u.kind}:${u.name}`), block, bytes, sha256: crypto.createHash('sha256').update(block).digest('hex') });
    }
    arm.forcedLoad = byTask;
    record[arm.id] = Object.fromEntries([...byTask].map(([id, f]) => [id, { units: f.units, sha256: f.sha256 }]));
  }
  if (problems.length) throw new Error(`--${FLAG} refused (${problems.length} problem(s)), nothing was run:\n- ${problems.join('\n- ')}`);
  return record;
}

/** What result.json records for one run, or null for an arm or task without a forced load. */
function forcedLoadResult(arm, task) {
  const f = arm?.forcedLoad?.get(task.id);
  return f ? { units: f.units, bytes: f.bytes, sha256: f.sha256 } : null;
}

module.exports = { applyForcedMustLoad, forcedLoadResult, renderBlock, unitOf, BEGIN, END };
