// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap select`: the selection test of one skill (selection.js). It writes one selection result, the file
// `cap keep-prune --selection FILE` reads to open the whole-skill gate. Three ways in, none of them paid:
//   --run stub-ID     the stub: a stub stream per request and repeat, read back with the runner's stream code; with
//                     --stub-behaviour fake, a fake model picks a skill from each request and the tree's skill index
//   --from-run DIR    scores a finished bench run of the selection tasks (results already paid for and approved)
//   --write-tasks DIR writes the selection tasks for a later run; running them is a paid run the owner approves first

const fs = require('node:fs');
const path = require('node:path');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { loadRun } = require('../report/load.js');
const { scanRunDirs, sessionUseOf } = require('./usage.js');
const { loadBaseline, BASELINES_DIR } = require('./frozen.js');
const { loadChecked } = require('./baselineformats.js');
const { assertSkillSubject } = require('./subjectunit.js');
const sel = require('./selection.js');
const { catalogOf, createFakePicker } = require('./fakepicker.js');

/**
 * The requests to run: the frozen selection.json of the skill's baseline, or a draft file.
 * @param {object} o { name, repo, baselinesDir, requestsFile }
 * @returns {{ set, sha256, frozen, unitSha256 }} `unitSha256` is today's loaded-unit hash of the skill
 */
function requestsOf({ name, repo, baselinesDir, requestsFile }) {
  const baseline = loadBaseline({ name, skillsDir: path.join(repo, 'skills'), dir: baselinesDir });
  if (requestsFile) {
    const { data } = loadChecked('selection', requestsFile, { skill: name });
    return { set: data, sha256: sel.sha256(fs.readFileSync(requestsFile)), frozen: false, unitSha256: baseline.unit.sha256 };
  }
  if (!baseline.selection) throw new Error(`${name} has no frozen selection.json in ${baselinesDir}; pass --requests FILE to score a draft (its result stays a draft)`);
  return { set: baseline.selection.set, sha256: baseline.selection.sha256, frozen: true, unitSha256: baseline.unit.sha256 };
}

/** The stub behaviour runStub takes: a named one, or for 'fake' a picker over the skill index of `repo`. */
function stubBehaviour(behaviour, repo) {
  if (behaviour !== 'fake' && !Object.hasOwn(sel.STUB_BEHAVIOURS, behaviour)) throw new Error(`--stub-behaviour takes ${[...Object.keys(sel.STUB_BEHAVIOURS), 'fake'].join(', ')} (got ${JSON.stringify(behaviour)})`);
  if (behaviour !== 'fake') return behaviour;
  const pick = createFakePicker({ catalog: catalogOf(repo) });
  return (request) => pick(request.prompt);
}

/**
 * Runs or scores the selection test and writes `<outDir>/<runId>/selection/<name>.json`.
 * @param {object} o
 * @param {string} o.name the skill
 * @param {string} o.repo the repository whose skills/ folder holds it
 * @param {string} o.outDir where run folders go
 * @param {string} [o.runId] stub or stub-<name>, for the stub
 * @param {string} [o.fromRun] a finished bench run folder to score instead of the stub
 * @param {number} [o.reps] stub repeats per request
 * @param {string} [o.behaviour] stub behaviour: always, never, correct, or fake (a fake model picks from the skill index)
 * @param {string} [o.requestsFile] a draft selection.json instead of the frozen one
 * @param {string} [o.baselinesDir] the frozen baselines folder
 * @param {string} [o.measuredAt] the date to record
 * @returns {{ result, file, scored }}
 */
function runSelect({ name, repo, outDir, runId = null, fromRun = null, reps = 3, behaviour = 'correct', requestsFile = null, baselinesDir = BASELINES_DIR, measuredAt, usageRuns = [] }) {
  // As in kprun.js: a name with a baseline but no skill folder is checked by its identity entry in the loader.
  if (!fs.existsSync(path.join(baselinesDir, name)) || fs.existsSync(path.join(repo, 'skills', name))) assertSkillSubject({ repo, name });
  const req = requestsOf({ name, repo, baselinesDir, requestsFile });
  let results;
  let source;
  let folder;
  if (fromRun) {
    results = loadRun(fromRun).runs.map((r) => r.result);
    source = fromRun;
    folder = path.join(outDir, path.basename(fromRun));
  } else {
    if (!runId) throw new Error('--run stub-<name> or --from-run DIR is required');
    folder = path.join(outDir, runId);
    results = sel.runStub({ name, set: req.set, runId, dir: path.join(folder, 'selection', name, 'streams'), reps, behaviour: stubBehaviour(behaviour, repo) });
    source = runId;
  }
  const scored = sel.scoreRun(results, name);
  const sessionUse = usageRuns.length ? sessionUseOf(scanRunDirs(usageRuns), name, usageRuns.join(',')) : null;
  const result = sel.selectionResult({ scored, set: req.set, setSha256: req.sha256, frozen: req.frozen, unitSha256: req.unitSha256, source, measuredAt, sessionUse });
  const file = path.join(folder, 'selection', `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return { result, file, scored };
}

const f2 = (v) => (v === null ? 'n/a' : v.toFixed(2));

/** The command: parses flags, runs runSelect or writes the tasks, and prints the result. */
function cmdSelect(opts) {
  const name = val(opts.skill);
  if (!name) throw new Error('--skill NAME is required');
  const repo = repoRootOf(opts);
  const requestsFile = val(opts.requests) ? path.resolve(val(opts.requests)) : null;
  const tasksDir = val(opts['write-tasks']);
  if (tasksDir) {
    assertSkillSubject({ repo, name });
    const req = requestsOf({ name, repo, baselinesDir: BASELINES_DIR, requestsFile });
    const made = sel.writeTasks({ name, set: req.set, dir: path.resolve(tasksDir) });
    console.log(`wrote ${made.length} selection task(s) to ${path.resolve(tasksDir)}. Running them is a paid run: it needs the owner's approval and a credit cap first.`);
    return;
  }
  const reps = val(opts.reps) === undefined ? 3 : Number(val(opts.reps));
  if (!Number.isInteger(reps) || reps < 1) throw new Error('--reps takes a whole number of 1 or more');
  const r = runSelect({
    name, repo, requestsFile, reps, behaviour: val(opts['stub-behaviour']) ?? 'correct',
    runId: val(opts.run) ?? null, fromRun: val(opts['from-run']) ? path.resolve(val(opts['from-run'])) : null,
    outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'keep-prune')),
    usageRuns: val(opts['usage-runs']) ? String(val(opts['usage-runs'])).split(',').filter(Boolean).map((d) => path.resolve(d)) : [],
  });
  if (opts.json) { console.log(JSON.stringify(r.result, null, 2)); return; }
  const x = r.result;
  console.log(`selection of ${name}: precision ${f2(x.triggerPrecision)}, recall ${f2(x.triggerRecall)}, observed use ${f2(x.observedUseRate)} over ${x.runs} selection runs, use in real sessions ${x.sessionUse ? `${f2(x.sessionUse.rate)} over ${x.sessionUse.runs} runs` : 'not read (--usage-runs DIR)'} (${x.requests.load} should load, ${x.requests.none} should not; ${x.failedLoads} failed loads; ${x.frozen ? 'frozen' : 'draft'} requests)`);
  const instead = Object.entries(r.scored.score.confusionCounts).map(([n, k]) => `${n} (${k})`).join(', ');
  if (instead) console.log(`picked instead on a wrong answer: ${instead}`);
  console.log(`wrote ${r.file}; pass it to cap keep-prune --selection${opts['from-run'] ? '' : ' (stub data: never a measurement)'}`);
}

module.exports = { requestsOf, runSelect, cmdSelect };
