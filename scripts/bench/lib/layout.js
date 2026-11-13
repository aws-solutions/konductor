// SPDX-License-Identifier: Apache-2.0
/**
 * Where everything lives, in one place:
 *
 *   skills/<skill>/SKILL.md                       the skill under test (read only)
 *   agents/*.agent-spec.json                      agents that declare skills (read only)
 *   bench/config.json                             the settings, copied from bench/config.example.json (git-ignored)
 *   bench/exclusions.json                         committed exclusion decisions
 *   bench/baselines/MANIFEST.json                 hash of every baseline file
 *   bench/baselines/<skill>/rules.json            frozen rules
 *   bench/baselines/<skill>/tasks-<batch>.json    frozen tasks, one file per batch
 *   bench/baselines/<skill>/tasks-<batch>.buckets.json
 *   bench/out/ledger.jsonl                        spend ledger, shared by every run (git-ignored)
 *   bench/out/<run-id>/report.json, report.md     run output (git-ignored)
 *   bench/out/<run-id>/answers/<skill>/<batch>/<task>.<with|without>.json
 *   bench/out/<run-id>/checklists/<skill>/<batch>/<task>.json              request-only checklist
 *   bench/out/<run-id>/judgments/<items|outcome>/<skill>/<batch>/<task>.<seat>.<with|without>.json
 *
 * The baseline, exclusions, ledger and report paths are fixed. The layout under
 * bench/out/<run-id>/ for answers, checklists and judgments is chosen here; code that writes those
 * files must use these helpers. Each answer is judged on its own, so a judgment file belongs to one arm: its
 * name holds the arm of the answer it scored. A seat name holds no "." and is lowercase (names.js),
 * so the file name of a judgment (<task>.<seat>.<arm>.json) belongs to exactly one (task, seat, arm), also
 * on a file system that ignores case. No name built here is longer than the 255-byte file name limit.
 *
 * Every name that becomes a path segment is checked, so a task id or run id cannot climb out of its folder.
 * The run id `ledger.jsonl` is refused: bench/out/ledger.jsonl is the spend ledger, so a run folder of that
 * name would be the ledger file itself.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SAFE_SEGMENT, SEAT_NAME, BATCH_NAME } = require('./names');

/** A name or value the layout cannot turn into a path. `plan` reports it as a problem instead of crashing. */
class LayoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LayoutError';
  }
}

/** The checkout that holds scripts/bench/ (three levels above this file). */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_RUN_ID = 'default';
// Names in bench/out/ that belong to the layout, not to a run. Compared in lower case, because a file system
// that ignores case (macOS, Windows) would make "Ledger.jsonl" the ledger file as well.
const RESERVED_RUN_IDS = Object.freeze(['ledger.jsonl']);
const ARMS = Object.freeze(['with', 'without']);
/** `items` is reading B (the rules checklist), `outcome` is reading A (the request-only checklist). */
const SCALES = Object.freeze(['items', 'outcome']);

// The name rule is shared with the file-format validators (names.js), so a task id or batch name
// they accept is one this layout accepts.
function requireSafeSegment(description, value) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new LayoutError(
      `unsafe ${description} for a file name: ${JSON.stringify(value)}`,
    );
  }
  return value;
}
// A seat is also a path segment, but it may not hold "." (names.js): the judgment file name joins task, seat and
// arm with dots, and a dotted seat would let two different (task, seat) pairs build one file. It is also
// lowercase and short, so seats cannot collide by case and the file name stays under the length limit.
function requireSeat(value) {
  if (typeof value !== 'string' || !SEAT_NAME.test(value)) {
    throw new LayoutError(
      `unsafe seat for a file name: ${JSON.stringify(value)}`,
    );
  }
  return value;
}
function requireRunId(value) {
  requireSafeSegment('run id', value);
  if (RESERVED_RUN_IDS.includes(value.toLowerCase()))
    throw new LayoutError(
      `run id ${JSON.stringify(value)} is reserved: bench/out/${RESERVED_RUN_IDS[0]} is the spend ledger`,
    );
  return value;
}
function requireOneOf(description, value, allowed) {
  if (!allowed.includes(value))
    throw new LayoutError(
      `${description} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`,
    );
  return value;
}

/** Paths for one repository root and one run. Nothing is read or created here except batches(). */
function createLayout({ root = REPO_ROOT, runId = DEFAULT_RUN_ID } = {}) {
  const benchDir = path.join(root, 'bench');
  const baselinesDir = path.join(benchDir, 'baselines');
  const outDir = path.join(benchDir, 'out');
  const runDir = path.join(outDir, requireRunId(runId));
  const baselineDir = (skill) =>
    path.join(baselinesDir, requireSafeSegment('skill', skill));
  const taskTree = (kind, skill, batch) =>
    path.join(
      runDir,
      kind,
      requireSafeSegment('skill', skill),
      requireSafeSegment('batch', batch),
    );

  return Object.freeze({
    root,
    runId,
    skillsDir: path.join(root, 'skills'),
    agentsDir: path.join(root, 'agents'),
    benchDir,
    configFile: path.join(benchDir, 'config.json'),
    exclusionsFile: path.join(benchDir, 'exclusions.json'),
    baselinesDir,
    manifestFile: path.join(baselinesDir, 'MANIFEST.json'),
    outDir,
    ledgerFile: path.join(outDir, 'ledger.jsonl'),
    runDir,
    reportJson: path.join(runDir, 'report.json'),
    reportMd: path.join(runDir, 'report.md'),

    skillDir: (skill) =>
      path.join(root, 'skills', requireSafeSegment('skill', skill)),
    skillMd: (skill) =>
      path.join(root, 'skills', requireSafeSegment('skill', skill), 'SKILL.md'),
    baselineDir,
    rulesFile: (skill) => path.join(baselineDir(skill), 'rules.json'),
    tasksFile: (skill, batch) =>
      path.join(
        baselineDir(skill),
        `tasks-${requireSafeSegment('batch', batch)}.json`,
      ),
    bucketsFile: (skill, batch) =>
      path.join(
        baselineDir(skill),
        `tasks-${requireSafeSegment('batch', batch)}.buckets.json`,
      ),

    answerFile: (skill, batch, taskId, arm) =>
      path.join(
        taskTree('answers', skill, batch),
        `${requireSafeSegment('task id', taskId)}.${requireOneOf('arm', arm, ARMS)}.json`,
      ),
    checklistFile: (skill, batch, taskId) =>
      path.join(
        taskTree('checklists', skill, batch),
        `${requireSafeSegment('task id', taskId)}.json`,
      ),
    judgmentFile: (scale, skill, batch, taskId, seat, arm) => {
      const dir = path.join(
        runDir,
        'judgments',
        requireOneOf('scale', scale, SCALES),
        requireSafeSegment('skill', skill),
        requireSafeSegment('batch', batch),
      );
      return path.join(
        dir,
        `${requireSafeSegment('task id', taskId)}.${requireSeat(seat)}.${requireOneOf('arm', arm, ARMS)}.json`,
      );
    },

    /** Batch names that have a task file in the skill's baseline folder, sorted. [] when there is no folder. A file whose name is not a valid batch name (`tasks--x.json`) is not a batch. */
    batches(skill) {
      let names;
      try {
        names = fs.readdirSync(baselineDir(skill));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      return names
        .map((fileName) => /^tasks-(.+)\.json$/.exec(fileName))
        .filter((match) => match && BATCH_NAME.test(match[1]))
        .map((match) => match[1])
        .sort();
    },
  });
}

module.exports = {
  REPO_ROOT,
  DEFAULT_RUN_ID,
  ARMS,
  SCALES,
  LayoutError,
  createLayout,
};
