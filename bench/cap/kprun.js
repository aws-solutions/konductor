// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap keep-prune`: runs the keep-or-prune check of one skill at the quick depth, the deep depth or both,
// with the convention control and the dose ladder in the same run, and writes one record with both blocks side by side.
// Phase A has only the stub provider, so a run needs a stub- run id and spends nothing.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { loadBaseline, loadConvention, loadDoseLadder, BASELINES_DIR } = require('./frozen.js');
const { checkDepth, judgmentStore, DEFAULT_REPLICATES } = require('./keepprune.js');
const { blockFromCheck, buildRecord, writeRecord, renderRecord } = require('./kprecord.js');
const { createStubProvider, assertStubRun } = require('./stubprovider.js');
const { assertSkillSubject } = require('./subjectunit.js');

/** The stub's default agent and judges: a Claude agent judged by three other families, as SR-24 needs. */
const STUB_SUBJECT_MODEL = 'claude-sonnet-5.5';
const STUB_JUDGES = Object.freeze(['deepseek-v3.2', 'glm-4.6', 'grok-4']);
const DEPTH_CHOICES = Object.freeze({ quick: ['quick'], deep: ['deep'], both: ['quick', 'deep'] });

const commitOf = (repo) => {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/**
 * Runs the check and writes `<outDir>/<runId>/records/<skill>.json` (and .md). Options:
 *   name          the skill (or the old name of a renamed or folded one); it needs a frozen baseline
 *   repo          the repository whose skills/<name>/SKILL.md is the skill under test
 *   runId         must be stub or stub-<name>; judgments are stored under the run folder and reused when current
 *   outDir        where run folders go
 *   depth         quick, deep or both
 *   provider      only 'stub' in phase A
 *   subjectModel  the agent's model id; its family decides the judge seats (SR-24)
 *   judges        judge model ids
 *   replicates    runs per arm and task in the deep check
 *   rejudge       make stale judgments again instead of refusing them
 *   baselinesDir  the frozen baselines folder (default bench/cap/baselines)
 * Returns { record, file, markdown }.
 */
function runKeepPrune({ name, repo, runId, outDir, depth = 'both', provider = 'stub', subjectModel = STUB_SUBJECT_MODEL, judges = STUB_JUDGES, replicates = DEFAULT_REPLICATES, rejudge = false, baselinesDir = BASELINES_DIR, createdAt }) {
  if (provider !== 'stub') throw new Error(`provider ${JSON.stringify(provider)} is not available: phase A has only the stub provider, and a live provider needs the owner's spend cap first`);
  if (!DEPTH_CHOICES[depth]) throw new Error(`--depth takes quick, deep or both (got ${JSON.stringify(depth)})`);
  assertStubRun(runId);
  const skillsDir = path.join(repo, 'skills');
  // A renamed or folded name has no folder of its own; the baseline loader checks its identity entry.
  if (!fs.existsSync(path.join(baselinesDir, name)) || fs.existsSync(path.join(skillsDir, name))) assertSkillSubject({ repo, name });
  const baseline = loadBaseline({ name, skillsDir, dir: baselinesDir });
  const ladder = loadDoseLadder();
  const stub = createStubProvider({ ladder });
  const runDir = path.join(outDir, runId);
  const store = judgmentStore(path.join(runDir, 'judgments'));
  const commit = commitOf(repo);
  const blocks = { quick: null, deep: null };
  for (const d of DEPTH_CHOICES[depth]) {
    const check = checkDepth({ depth: d, subject: baseline, convention: loadConvention(), ladder, provider: stub, subjectModel, judges, bWaiting: baseline.bWaiting, subjectNoData: [baseline.staleWhy, baseline.identityWhy], store, replicates, rejudge });
    blocks[d] = blockFromCheck(check, { commit, runId, provider: stub.name, replicates: d === 'deep' ? replicates : null, bWaiting: baseline.bWaiting });
  }
  const record = buildRecord({ skill: baseline.skill, quick: blocks.quick, deep: blocks.deep, baseline, createdAt });
  const file = writeRecord(path.join(runDir, 'records', `${name}.json`), record);
  const markdown = renderRecord(record);
  fs.writeFileSync(file.replace(/\.json$/, '.md'), markdown);
  return { record, file, markdown };
}

const val = (v) => (v === undefined || v === true ? undefined : String(v));

/** The command: parses flags, runs runKeepPrune and prints the record table (or the record with --json). */
function cmdKeepPrune(opts) {
  const name = val(opts.skill);
  if (!name) throw new Error('--skill NAME is required (a skill with a frozen baseline under bench/cap/baselines)');
  const runId = val(opts.run);
  if (!runId) throw new Error('--run stub-<name> is required');
  const reps = val(opts.replicates);
  const replicates = reps === undefined ? DEFAULT_REPLICATES : Number(reps);
  if (!Number.isInteger(replicates) || replicates < 1) throw new Error('--replicates takes a whole number of 1 or more');
  const r = runKeepPrune({
    name, runId, repo: path.resolve(val(opts['repo-root']) ?? process.env.BENCH_REPO_ROOT ?? path.resolve(BENCH_DIR, '..')),
    outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'keep-prune')), depth: val(opts.depth) ?? 'both', provider: val(opts.provider) ?? 'stub',
    subjectModel: val(opts['subject-model']) ?? STUB_SUBJECT_MODEL, judges: val(opts.judges) ? val(opts.judges).split(',').filter(Boolean) : STUB_JUDGES,
    replicates, rejudge: Boolean(opts.rejudge),
  });
  if (opts.json) { console.log(JSON.stringify(r.record, null, 2)); return; }
  console.log(`${r.markdown}\nwrote ${r.file} and its .md (stub data: never a measurement)`);
}

module.exports = { STUB_SUBJECT_MODEL, STUB_JUDGES, runKeepPrune, cmdKeepPrune };
