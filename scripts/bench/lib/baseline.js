// SPDX-License-Identifier: Apache-2.0
/**
 * Reads one skill's frozen baseline and checks it as a whole: every file
 * against its format, the files against each other, and the hashes that mark work stale.
 *
 * Nothing here throws for a bad baseline. Problems come back as strings so `plan` can list them
 * for every selected skill. Stale is not invalid:
 *   rulesStale   SKILL.md changed since the rules were written. Reading B waits for a refreshed baseline.
 *   tasks[].stale  the rules file changed since the tasks were written. Reading B is stale for that batch.
 * Reading A needs only the tasks, so a stale skill can still be read by A.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadChecked, validateRules, FormatError } = require('./formats');
const { fileSha256 } = require('./provenance');
const { readFile, readJsonFile } = require('./read-file');
const { SAFE_SEGMENT } = require('./names');

/**
 * Whether `file` exists. Only "not there" (ENOENT) is false. Any other failure (a symlink loop, a folder without
 * search permission) is thrown as the system error with `path` set, so a file that cannot be checked is never taken
 * for one that is absent. `fs.existsSync` answers false for all of them.
 */
function fileExists(file) {
  try {
    fs.statSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * @returns {{ hasBaseline: boolean, rules: object|null, rulesStale: boolean,
 *   batches: {batch: string, tasks: object, stale: boolean}[], problems: string[], warnings: string[] }}
 */
function loadBaseline(layout, skill) {
  const baseline = {
    skill,
    hasBaseline: false,
    rules: null,
    rulesStale: false,
    batches: [],
    problems: [],
    warnings: [],
  };
  const batchNames = layout.batches(skill);
  const hasRulesFile = fileExists(layout.rulesFile(skill));
  if (!hasRulesFile && !batchNames.length) return baseline;
  baseline.hasBaseline = true;

  const readChecked = (file, kind, context) => {
    const name = path.basename(file);
    try {
      const { data, warnings } = loadChecked(kind, file, context);
      baseline.warnings.push(
        ...warnings.map((warning) => `${name}: ${warning}`),
      );
      return data;
    } catch (error) {
      // Only a file that is not there is "missing". Any other read failure (permission denied, a symlink loop)
      // goes on as the system error, which the driver reports as an I/O error.
      if (!(error instanceof FormatError) && error.code === 'ENOENT')
        return void baseline.problems.push(`${name}: file is missing`);
      if (!(error instanceof FormatError)) throw error;
      baseline.problems.push(
        ...error.errors.map((message) => `${name}: ${message}`),
      );
      return undefined;
    }
  };

  const rules = readChecked(layout.rulesFile(skill), 'rules', { skill });
  if (rules) {
    baseline.rules = rules;
    baseline.rulesStale =
      rules.skill_md_sha256 !== fileSha256(layout.skillMd(skill));
    // The quotes can only be checked against the text the rules were written from.
    if (!baseline.rulesStale) {
      const skillMd = readFile(layout.skillMd(skill), 'utf8');
      baseline.problems.push(
        ...validateRules(rules, { skill, skillMd }).errors.map(
          (message) => `rules.json: ${message}`,
        ),
      );
    }
  }
  const rulesSha = rules ? fileSha256(layout.rulesFile(skill)) : null;
  // A baseline with rules and no tasks has nothing to run; it must not read as ready at $0.00.
  if (!batchNames.length && hasRulesFile)
    baseline.problems.push(
      `tasks-<batch>.json: no task file for skill "${skill}"; rules.json is there but there are no tasks to run`,
    );

  for (const batch of batchNames) {
    const tasks = readChecked(layout.tasksFile(skill, batch), 'tasks', {
      skill,
      batch,
      rules,
    });
    readChecked(layout.bucketsFile(skill, batch), 'buckets', { rules, tasks });
    if (tasks)
      baseline.batches.push({
        batch,
        tasks,
        stale: rulesSha !== null && tasks.rules_sha256 !== rulesSha,
      });
  }
  return baseline;
}

/**
 * bench/exclusions.json, or an empty one when the file does not exist. Throws FormatError when it is invalid, and the
 * system error when the file exists but cannot be read (a symlink loop, permission denied).
 */
function loadExclusions(layout) {
  try {
    return loadChecked('exclusions', layout.exclusionsFile).data;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { format_version: 1, batches: {} };
  }
}

/** Task ids of one batch name that exist in any skill with a baseline folder: Map(batch -> Set(task id)). */
function knownTaskIds(layout) {
  const known = new Map();
  if (!fs.existsSync(layout.baselinesDir)) return known;
  const skills = fs
    .readdirSync(layout.baselinesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SAFE_SEGMENT.test(entry.name));
  for (const { name: skill } of skills) {
    for (const batch of layout.batches(skill)) {
      let scenarios;
      try {
        scenarios = readJsonFile(layout.tasksFile(skill, batch)).scenarios;
      } catch (unreadable) {
        continue; // unreadable here; the skill's own check reports it when it is selected
      }
      if (!known.has(batch)) known.set(batch, new Set());
      for (const scenario of Array.isArray(scenarios) ? scenarios : [])
        if (scenario && typeof scenario.id === 'string')
          known.get(batch).add(scenario.id);
    }
  }
  return known;
}

/** The ids a batch's exclusion records name that this skill's tasks include. */
function exclusionsFor(exclusions, batch, taskIds) {
  const present = new Set(taskIds);
  return {
    excluded: new Set(
      listExclusionRecords(exclusions, batch)
        .filter((record) => present.has(record.id))
        .map((record) => record.id),
    ),
  };
}

/**
 * Ids in a batch's exclusion records that no task of the batch has, in any skill with a baseline
 * (`known` is knownTaskIds()). Batch names are shared by every skill, so a record for another skill's
 * task is not unmatched; only a record that names no task anywhere excludes nothing and is a likely typo.
 */
function unmatchedExclusions(exclusions, batch, known) {
  const knownIds = known.get(batch) || new Set();
  return listExclusionRecords(exclusions, batch)
    .filter((record) => !knownIds.has(record.id))
    .map((record) => record.id);
}

const listExclusionRecords = (exclusions, batch) =>
  Object.hasOwn(exclusions.batches, batch)
    ? exclusions.batches[batch].scenarios
    : [];

module.exports = {
  loadBaseline,
  loadExclusions,
  exclusionsFor,
  knownTaskIds,
  unmatchedExclusions,
};
