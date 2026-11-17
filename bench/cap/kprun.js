// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap keep-prune`: runs the keep-or-prune check of one skill at the quick depth, the deep depth or both,
// with the convention control and the dose ladder in the same run, and writes one record with both blocks side by side.
// Every block is the conditional effect after load; the whole-skill call stays NO DATA until a separate selection
// result is given (--selection FILE). Only skills are checked: an agent, SOP, context or steering name is refused.
// Phase A has only the stub provider, so a run needs a stub- run id and spends nothing.

const fs = require('node:fs');
const path = require('node:path');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { loadBaseline, loadConvention, loadDoseLadder, BASELINES_DIR } = require('./frozen.js');
const { checkDepth, judgmentStore, DEFAULT_REPLICATES, CLAIM } = require('./keepprune.js');
const { blockFromCheck, buildRecord, writeRecord, renderRecord, selectionProblems } = require('./kprecord.js');
const { createStubProvider, assertStubRun } = require('./stubprovider.js');
const { subjectSource, assertSkillSubject } = require('./subjectunit.js');
const { readJsonFile } = require('./checkedjson.js');

/** The stub's default agent and judges: a Claude agent judged by three other families, as SR-24 and the panel rule need. */
const STUB_SUBJECT_MODEL = 'claude-sonnet-5.5';
const STUB_JUDGES = Object.freeze(['deepseek-v3.2', 'glm-4.6', 'grok-4']);
const DEPTH_CHOICES = Object.freeze({ quick: ['quick'], deep: ['deep'], both: ['quick', 'deep'] });

/**
 * The record's unit, baseline and identity blocks from a loaded baseline.
 * @param {object} baseline loadBaseline's result
 * @param {string} repo the repository root, for the Git source
 */
function provenanceOf(baseline, repo) {
  const unit = { manifestSha256: baseline.unit.sha256, paths: baseline.unit.paths, unresolved: baseline.unit.unresolved, source: subjectSource({ repo, name: baseline.skill.name, paths: baseline.unit.paths }) };
  const base = { manifestSha256: baseline.manifestSha256, legacy: baseline.recorded.legacy, unitSha256: baseline.recorded.unitSha256, source: baseline.recorded.source, staleWhy: baseline.staleWhy };
  const id = baseline.identity;
  const identity = id ? { name: baseline.name, replacedBy: id.replaced_by, how: id.how, approvedBy: id.migration.approved_by, why: baseline.identityWhy } : null;
  return { unit, baseline: base, identity };
}

/**
 * Runs the check and writes `<outDir>/<runId>/records/<name>.json` (and .md).
 * @param {object} o
 * @param {string} o.name the skill (or the old name of a renamed or folded one); it needs a frozen baseline
 * @param {string} o.repo the repository whose skills/ folder holds the skill under test
 * @param {string} o.runId must be stub or stub-<name>; judgments are stored under the run folder and reused when current
 * @param {string} o.outDir where run folders go
 * @param {string} [o.depth] quick, deep or both
 * @param {string} [o.provider] only 'stub' in phase A
 * @param {string} [o.subjectModel] the agent's model id; its family decides the judge seats (SR-24)
 * @param {string[]} [o.judges] judge model ids; three distinct families other than the agent's are needed
 * @param {number} [o.replicates] runs per arm and task in the deep check
 * @param {boolean} [o.rejudge] make stale judgments again instead of refusing them
 * @param {object|null} [o.selection] a separate selection result, or null (the whole-skill call is then NO DATA)
 * @param {string} [o.baselinesDir] the frozen baselines folder
 * @returns {{ record, file, markdown }}
 */
function runKeepPrune({ name, repo, runId, outDir, depth = 'both', provider = 'stub', subjectModel = STUB_SUBJECT_MODEL, judges = STUB_JUDGES, replicates = DEFAULT_REPLICATES, rejudge = false, selection = null, baselinesDir = BASELINES_DIR, createdAt }) {
  if (provider !== 'stub') throw new Error(`provider ${JSON.stringify(provider)} is not available: phase A has only the stub provider, and a live provider needs the owner's spend cap first`);
  if (!DEPTH_CHOICES[depth]) throw new Error(`--depth takes quick, deep or both (got ${JSON.stringify(depth)})`);
  assertStubRun(runId);
  if (selection) { const p = selectionProblems(selection); if (p.length) throw new Error(`--selection: ${p.join('; ')}`); }
  const skillsDir = path.join(repo, 'skills');
  // A renamed or folded name has no folder of its own; its identity entry is checked by the baseline loader.
  if (!fs.existsSync(path.join(baselinesDir, name)) || fs.existsSync(path.join(skillsDir, name))) assertSkillSubject({ repo, name });
  const baseline = loadBaseline({ name, skillsDir, dir: baselinesDir });
  const ladder = loadDoseLadder();
  const stub = createStubProvider({ ladder });
  const runDir = path.join(outDir, runId);
  const store = judgmentStore(path.join(runDir, 'judgments'));
  const prov = provenanceOf(baseline, repo);
  const subjectNoData = [baseline.staleWhy, baseline.identityWhy];
  const blocks = { quick: null, deep: null };
  for (const d of DEPTH_CHOICES[depth]) {
    const check = checkDepth({ depth: d, subject: baseline, convention: loadConvention(), ladder, provider: stub, subjectModel, judges, bWaiting: baseline.bWaiting, subjectNoData, store, replicates, rejudge });
    blocks[d] = blockFromCheck(check, { commit: prov.unit.source.commit, runId, provider: stub.name, replicates: d === 'deep' ? replicates : null, bWaiting: baseline.bWaiting });
  }
  const record = buildRecord({ skill: { name, sha256: baseline.skill.sha256 }, ...prov, selection, quick: blocks.quick, deep: blocks.deep, createdAt });
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
  const selectionFile = val(opts.selection);
  const r = runKeepPrune({
    name, runId, repo: path.resolve(val(opts['repo-root']) ?? process.env.BENCH_REPO_ROOT ?? path.resolve(BENCH_DIR, '..')),
    outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'keep-prune')), depth: val(opts.depth) ?? 'both', provider: val(opts.provider) ?? 'stub',
    subjectModel: val(opts['subject-model']) ?? STUB_SUBJECT_MODEL, judges: val(opts.judges) ? val(opts.judges).split(',').filter(Boolean) : STUB_JUDGES,
    replicates, rejudge: Boolean(opts.rejudge), selection: selectionFile ? readJsonFile(path.resolve(selectionFile)) : null,
  });
  if (opts.json) { console.log(JSON.stringify(r.record, null, 2)); return; }
  console.log(`${r.markdown}\nwrote ${r.file} and its .md (${CLAIM}; stub data: never a measurement)`);
}

module.exports = { STUB_SUBJECT_MODEL, STUB_JUDGES, provenanceOf, runKeepPrune, cmdKeepPrune };
