// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared fixtures for the per-skill study tests: a small konductor-shaped repo with a sectioned skill, a bench dir and
// finished run directories to plan from. Nothing here calls a model.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { write } = require('./helpers.js');
const { pruneFiles, makeRunDir, V1, VAN } = require('./cap-prune-helpers.js');
const { makeCapRepo, makeCapBench, spec } = require('./cap-helpers.js');

const section = (title, n) => `## ${title}\n\n${Array.from({ length: n }, (_, i) => `${title} line ${i + 1} with enough words to take some bytes.`).join('\n')}\n`;
const SECTIONED = `---\nname: sectioned\ndescription: Use when tracing sectioned flows through services. Maps the flow.\n---\n\n# Sectioned\n\nOpening.\n\n${section('Workflow', 30)}\n${section('Template', 30)}\n${section('Checklist', 30)}\n`;

function env() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'captest-'));
  const r = makeCapRepo(root, {
    files: (repo) => {
      pruneFiles(repo);
      write(path.join(repo, 'skills/sectioned/SKILL.md'), SECTIONED);
      const names = ['used', 'idle', 'pref', 'harmful', 'helped', 'big', 'twina', 'twinb', 'sectioned'];
      write(path.join(repo, 'agents/konductor.agent-spec.json'), `${JSON.stringify(spec('konductor', { skills: names, contexts: ['core.md'], subagents: ['k-dev'], claudeSkills: names }), null, 2)}\n`);
    },
  });
  const bench = makeCapBench(root);
  return { root, repo: r.repo, bench, runs: path.join(root, 'runs'), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const SHARED = (e, over = {}) => ({ repo: e.repo, base: 'v0', benchDir: e.bench, runDirs: [], tmpRoot: e.root, now: new Date('2026-01-01T00:00:00Z'), ...over });

function withRuns(e, { tasks = ["rev-one"] } = {}) {
  const dir = path.join(e.runs, 'r1');
  const rows = [];
  for (const task of tasks) for (let i = 1; i <= 5; i++) rows.push({ arm: 'v1', task, rep: i, loads: i <= 4 ? ['sectioned'] : ['sectioned', 'helped'], credits: 3 + i, wallClockMs: 60000 * i, model: 'claude-sonnet-5.5', armConfig: { orchestration: { mode: 'coordinator' } } });
  rows.push({ arm: 'v1', task: 'rev-one', rep: 6, loads: [], credits: null, status: 'timeout', wallClockMs: 600000, model: 'claude-sonnet-5.5' });
  rows.push({ arm: 'vanilla', task: 'rev-one', rep: 1, loads: [], credits: 99, model: 'claude-sonnet-5.5' });
  rows.push({ arm: 'v1', task: 'hid-one', rep: 1, loads: [], credits: 20, model: 'other-model' });
  makeRunDir(dir, { arms: [V1, VAN], runs: rows });
  return dir;
}


module.exports = { env, SHARED, withRuns, SECTIONED, section };
