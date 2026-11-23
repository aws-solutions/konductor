// SPDX-License-Identifier: Apache-2.0
'use strict';

// What a Kiro CLI run actually loaded at session start (DEBT D-35): the first `context_usage` event of an engine v3
// stream carries a `breakdown` of context files (skill globs among them) and tool tokens. The fixture line is copied
// from a real konductor-forced run (2026-11-22, kiro-cli v3), with its temp paths and session id replaced.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { observedListingOf } = require('../../plugins/kiro-cli/listing.js');
const kiro = require('../../plugins/kiro-cli/harness.js');
const { tmp, write } = require('./helpers.js');

const LINE = fs.readFileSync(path.join(__dirname, 'fixtures', 'kiro-context-breakdown.jsonl'), 'utf8');

test('the first context_usage breakdown gives the skill files matched, the context files and the tool tokens', () => {
  const o = observedListingOf(LINE);
  assert.equal(o.source, 'first context_usage breakdown in stream.jsonl');
  assert.deepEqual(o.skillFiles, [{ name: '.kiro/skills/ws-*/SKILL.md', matched: false, tokens: 0, progressivelyLoaded: false, reason: 'empty-glob' }]);
  assert.equal(o.skillFilesMatched, 0);
  assert.deepEqual(o.contextFiles.map((c) => c.name), ['AGENTS.md', '~/.kiro/context/k-direct-work.md', '~/.kiro/context/k-orchestrator-shared.md', '~/.kiro/context/k-core-rules.md']);
  assert.equal(o.contextTokens, 6525);
  assert.deepEqual(o.toolTokens, { builtin: 7537, mcp: 0 });
});

test('a stream with no breakdown (engine v2, or a run that never started) gives null', () => {
  assert.equal(observedListingOf(''), null);
  assert.equal(observedListingOf(`${JSON.stringify({ type: 'metadata', data: { meteringUsage: [] } })}\n`), null);
});

test('kiro.observedListing reads the run directory stream', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'stream.jsonl'), LINE);
    assert.equal(kiro.observedListing(dir).skillFilesMatched, 0);
    assert.equal(kiro.observedListing(path.join(dir, 'missing')), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Kiro run with an arm listing record carries what its stream says it loaded, as skillListing.observed', async () => {
  const { makeBench } = require('./helpers.js');
  const { makeFakeKiro } = require('./fake-kiro.js');
  const { executeRun } = require('../lib/run-one.js');
  const { loadTasks } = require('../lib/tasks.js');
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const breakdown = JSON.parse(LINE).data.update._meta.kiro.breakdown;
  makeFakeKiro(bin, { dir: probe, sessionJson: true, contextBreakdown: breakdown });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  const watch = path.join(root, 'watch');
  fs.mkdirSync(scratchDir);
  fs.mkdirSync(watch);
  const arm = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
  const record = kiro.vanillaSkillListing().skillListing;
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v3' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    skillListings: new Map([['vanilla', { listing: record }]]),
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  try {
    const r = await executeRun({ arm, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir: path.join(root, 'out', 't1'), inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.skillListing.skillsSent, record.skillsSent, 'the arm record stays as it was');
    assert.equal(r.skillListing.observed.skillFilesMatched, 0);
    assert.equal(r.skillListing.observed.contextTokens, 6525);
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
