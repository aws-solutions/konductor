// SPDX-License-Identifier: Apache-2.0
'use strict';

// A fake bench.js runner for the study driver tests: it writes run directories, a summary and a ledger the way a finished
// wave would look, with a pass rate per arm, and answers the controls check. No model, no kiro-cli, no opencode.

const fs = require('node:fs');
const path = require('node:path');
const { makeRunDir } = require('./cap-prune-helpers.js');
const { write } = require('./helpers.js');
const { env, withRuns } = require('./cap-study-helpers.js');
const { planSkillStudy } = require('../../cap/skillplan.js');
const { initStudy, runStudy } = require('../../cap/skillstudy.js');

process.env.BENCH_CAP_INSTALLS_HOMES = require('node:os').tmpdir() + '/no-installs-here';

const REPS = 8;

process.env.BENCH_CAP_INSTALLS_HOMES = require('node:os').tmpdir() + '/no-installs-here';

function setup({ tiers = ['loaded'], skills = ['sectioned'], e = env(), planOpts = {} } = {}) {
  const runs = withRuns(e, { tasks: ['rev-one', 'hid-one'] });
  const plan = planSkillStudy({ repo: e.repo, base: 'v0', benchDir: e.bench, runDirs: [runs], tmpRoot: e.root, tasksPerSkill: 2, reps: REPS, maxSections: 3, minSectionBytes: 500, skills, tiers, largeNames: [], largeTop: 0, ...planOpts });
  const studyDir = path.join(e.root, 'study');
  const creds = path.join(e.root, 'creds');
  fs.writeFileSync(creds, 'placeholder');
  const settings = { repo: e.repo, base: 'v0', benchDir: e.bench, extraTasks: [], scratch: path.join(e.root, 'scratch'), engine: 'v3', model: 'claude-sonnet-5.5', profile: 'detailed', seed: 7, controlReps: 5, judgeBackend: 'opencode', credsFile: creds, awsProfile: 'bench', awsRegion: 'us-east-1', budgetUsdPerWave: 5, parallel: 1, concurrency: 2 };
  initStudy({ studyDir, plan, settings });
  return { e, plan, studyDir, settings, creds };
}

// quality: pass probability by arm id (tenths); trusted: what the controls check says.
function fakeExec({ quality = {}, trusted = true, calls = [] } = {}) {
  const flag = (argv, name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const exec = async ({ argv }) => {
    calls.push(argv);
    if (argv[0] === 'cap' && argv[1] === 'controls' && argv.includes('--check')) {
      const dir = argv[argv.indexOf('--check') + 1];
      fs.writeFileSync(path.join(dir, 'controls-check.json'), JSON.stringify({ trusted }));
      return { code: trusted ? 0 : 1 };
    }
    if (argv[0] === 'judge') { fs.writeFileSync(path.join(flag(argv, 'run'), 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'ctl', judges: [], modes: ['rubric'], rubric: [], pairwise: [] })); return { code: 0 }; }
    if (argv[0] !== 'run') return { code: 0 };
    const out = flag(argv, 'out');
    const armIds = flag(argv, 'arms').split(',').map((a) => a.slice(0, a.indexOf('=')));
    const tasks = flag(argv, 'tasks').split(',');
    const reps = Number(flag(argv, 'replicates'));
    const skill = /skills\/([^/]+)\/w\d/.exec(out)?.[1] ?? null;
    const screened = armIds.filter((a) => a.startsWith('del-')).map((a) => a.slice(4));
    const arms = armIds.map((id) => ({ id, ref: 'v0', sha: 'a'.repeat(40) }));
    const rows = [];
    for (const arm of armIds) {
      tasks.forEach((task, ti) => {
        for (let rep = 1; rep <= reps; rep++) {
          const p = quality[arm] ?? 0.8;
          const i = ti * reps + rep - 1;
          const passed = Math.max(0, Math.min(10, Math.round(10 * (p + (i % 2 ? 0.1 : -0.1)))));
          rows.push({ arm, task, rep, loads: screened.length ? screened.filter((k) => arm !== `del-${k}`) : skill && arm !== 'del' ? [skill] : [], credits: 4, hiddenTests: { passed, total: 10 } });
        }
      });
    }
    makeRunDir(out, { arms, runs: rows });
    write(path.join(out, 'summary.json'), JSON.stringify({ interrupted: null, isolationGate: { ok: true }, armIds, replicates: reps, taskIds: tasks, results: rows.map(() => ({ status: 'success' })) }));
    write(path.join(out, 'credit-ledger.jsonl'), `${rows.map(() => JSON.stringify({ kind: 'run', credits: 4, charged: 4 })).join('\n')}\n`);
    return { code: 0 };
  };
  return { exec, calls };
}


async function setupAndRun(e, quality) {
  const s = setup({ e });
  const { exec } = fakeExec({ quality });
  await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
  return s;
}

module.exports = { setup, fakeExec, setupAndRun, REPS };
