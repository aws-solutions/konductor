// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which skills a run was offered, counted against the agent that started it. Synthetic runs only; no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { makeRunDir, V1 } = require('./cap-prune-helpers.js');
const { scanRunDirs, exposureOf, tallyUsage } = require('../../cap/usage.js');
const kiro = require('../lib/harness/kiro.js');

const LISTED = { orchestratorOnly: ['konductor'], specialistOnly: ['k-developer'], ownerNeverSpawned: ['k-product-manager'], both: ['konductor', 'k-developer'] };
const listedBy = (name) => LISTED[name] ?? [];
const cap = (name) => ({ id: `skill:${name}`, name });

function scan(runs) {
  const dir = makeRunDir(path.join(tmp(), 'run'), { arms: [V1], runs: runs.map((r) => ({ arm: 'v1', ...r })) });
  return { dir, ...scanRunDirs([dir]) };
}
const byTask = (s, task) => s.runs.find((r) => r.task === task);
const exposure = (run, name) => exposureOf(run, cap(name), listedBy(name));

test('a run entered through k-developer is not counted against the filter of a stale konductor file', () => {
  const s = scan([{ task: 'stale', agent: 'k-developer', installedAs: 'konductor', filter: ['orchestratorOnly', 'both'] }]);
  try {
    assert.equal(s.staleInstalled, 1);
    const run = byTask(s, 'stale');
    assert.equal(run.entryAgent, 'k-developer');
    assert.equal(run.entryFilter, null);
    assert.equal(exposure(run, 'orchestratorOnly').exposed, false);
    assert.deepEqual([exposure(run, 'specialistOnly').exposed, exposure(run, 'specialistOnly').via], [true, 'entry-listing']);
    assert.equal(exposure(run, 'both').via, 'entry-listing');
  } finally { fs.rmSync(path.dirname(s.dir), { recursive: true, force: true }); }
});

test('a run that kept the entry agent\'s own file is counted against that file\'s filter', () => {
  const s = scan([
    { task: 'dev', agent: 'k-developer', filter: ['specialistOnly'] },
    { task: 'orch', agent: 'konductor', filter: ['orchestratorOnly'] },
  ]);
  try {
    assert.equal(s.staleInstalled, 0);
    const dev = byTask(s, 'dev');
    const orch = byTask(s, 'orch');
    assert.deepEqual([exposure(dev, 'specialistOnly').exposed, exposure(dev, 'specialistOnly').via], [true, 'entry-filter']);
    assert.equal(exposure(dev, 'orchestratorOnly').exposed, false);
    assert.deepEqual([exposure(orch, 'orchestratorOnly').exposed, exposure(orch, 'orchestratorOnly').via], [true, 'entry-filter']);
    assert.equal(exposure(orch, 'specialistOnly').exposed, false);
  } finally { fs.rmSync(path.dirname(s.dir), { recursive: true, force: true }); }
});

test('a skill only an unspawned agent lists is not exposed; spawning the owner exposes it; a load proves it', () => {
  const s = scan([
    { task: 'plain', agent: 'konductor' },
    { task: 'spawned', agent: 'konductor', delegate: ['k-product-manager'] },
    { task: 'loaded', agent: 'konductor', loads: ['ownerNeverSpawned'] },
  ]);
  try {
    assert.equal(exposure(byTask(s, 'plain'), 'ownerNeverSpawned').exposed, false);
    assert.deepEqual([exposure(byTask(s, 'spawned'), 'ownerNeverSpawned').exposed, exposure(byTask(s, 'spawned'), 'ownerNeverSpawned').via], [true, 'delegated']);
    assert.equal(exposure(byTask(s, 'loaded'), 'ownerNeverSpawned').via, 'loaded');
  } finally { fs.rmSync(path.dirname(s.dir), { recursive: true, force: true }); }
});

test('the tally for runs entered through two agents splits entry listing from delegation', () => {
  const s = scan([
    { task: 'a', rep: 1, agent: 'konductor', filter: ['orchestratorOnly'], delegate: ['k-developer'] },
    { task: 'a', rep: 2, agent: 'k-developer', installedAs: 'konductor', filter: ['orchestratorOnly'] },
    { task: 'a', rep: 3, agent: 'k-developer', filter: ['specialistOnly'] },
  ]);
  try {
    const tally = tallyUsage(s.runs, [cap('orchestratorOnly'), cap('specialistOnly')], (id) => listedBy(id.replace('skill:', '')), ['kiro-cli']);
    const orch = tally['kiro-cli']['skill:orchestratorOnly'];
    const dev = tally['kiro-cli']['skill:specialistOnly'];
    assert.equal(orch.exposed, 1);
    assert.deepEqual(orch.basis, { 'entry-filter': 1 });
    assert.equal(dev.exposed, 3);
    assert.deepEqual(dev.basis, { delegated: 1, 'entry-listing': 1, 'entry-filter': 1 });
  } finally { fs.rmSync(path.dirname(s.dir), { recursive: true, force: true }); }
});

test('the harness saves the entry agent\'s own file as installed-agent.json', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.kiro/agents'), { recursive: true });
    for (const name of ['konductor', 'k-developer']) fs.writeFileSync(path.join(home, '.kiro/agents', `${name}.json`), JSON.stringify({ name }));
    const saved = (arm) => {
      const out = fs.mkdtempSync(path.join(root, 'out-'));
      kiro.collectArtifacts(home, out, { arm });
      return JSON.parse(fs.readFileSync(path.join(out, 'installed-agent.json'), 'utf8')).name;
    };
    assert.equal(saved({ agent: 'k-developer' }), 'k-developer');
    assert.equal(saved({}), 'konductor');
    assert.equal(saved(undefined), 'konductor');
    const none = fs.mkdtempSync(path.join(root, 'out-'));
    kiro.collectArtifacts(path.join(root, 'empty'), none, { arm: { agent: 'k-developer' } });
    assert.equal(fs.existsSync(path.join(none, 'installed-agent.json')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
