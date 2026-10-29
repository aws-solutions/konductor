// SPDX-License-Identifier: Apache-2.0
'use strict';

// The same multi-turn conversation through the opencode harness, against a fake opencode: no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { opencode: oc } = require('../lib/harness/index.js');
const { validateResult } = require('../lib/result.js');

const FX = path.join(__dirname, 'fixtures');
const MODEL = 'global.anthropic.claude-sonnet-5-5';
const SID = 'ses_e7b047669ffea6BvJf34zDKxOm';
const OC_VANILLA = { id: 'oc-vanilla', label: 'oc-vanilla', ref: null, commitSha: null, harness: 'none', runtime: 'opencode', agent: null, vanilla: true };
const AUTONOMY = { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['seconds?'], answer: 'Seconds.' }] };

const stream = (text, reason) => [
  { type: 'step_start', timestamp: 1000, sessionID: SID, part: { type: 'step-start' } },
  { type: 'text', timestamp: 1001, sessionID: SID, part: { type: 'text', text } },
  { type: 'step_finish', timestamp: 1002, sessionID: SID, part: { reason, type: 'step-finish', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.01 } },
].map((e) => JSON.stringify(e)).join('\n') + '\n';

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, class: 'autonomy', tiers: ['autonomy'], autonomy: AUTONOMY }));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  write(path.join(root, 'turn1.jsonl'), stream('Should the timeout be in seconds or milliseconds?', 'stop'));
  write(path.join(root, 'turn2.jsonl'), stream('Done. I assumed seconds.', 'stop'));
  const bin = makeFakeOpencode(path.join(root, 'bin'), {
    dir: probe, streamFile: path.join(root, 'turn1.jsonl'), streamFiles: [path.join(root, 'turn1.jsonl'), path.join(root, 'turn2.jsonl')],
    rowsFile: path.join(FX, 'opencode-vanilla.rows.json'), sessionID: SID,
  });
  write(path.join(root, 'creds'), '[bench]\naws_access_key_id = AK' + 'IATESTTESTTEST1234\naws_secret_access_key = fakeSecretValueNotReal0123456789abcdefgh\n');
  write(path.join(root, 'rg'), '#!/bin/sh\n');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, effort: 'low' }, scratchDir, awsCredsFile: path.join(root, 'creds'), awsProfile: 'bench',
    opencode: { bin, version: '1.19.5', sha256: 'x' }, rgBin: path.join(root, 'rg'), envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '1.19.5', modelListSnapshotPath: null, region: 'us-east-1' },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  return { root, ctx, task: loadTasks(bench).get('t1'), probe, scratchDir, outDir: path.join(root, 'out', 't1'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('buildCommand resumes the session with -s, or -c when no id is known', () => {
  const ctx = { opencode: { bin: '/x/opencode' } };
  const config = { model: MODEL, effort: 'low' };
  const task = { prompt: 'do it' };
  const a = oc.buildCommand({ arm: OC_VANILLA, task, config, ctx, cwd: '/w', resume: { sessionId: SID, prompt: 'Seconds.' } });
  assert.deepEqual(a.args.slice(-3), ['-s', SID, 'Seconds.']);
  assert.ok(a.args.includes('--dir') && a.args.includes('--auto') && a.args.includes('json'));
  const b = oc.buildCommand({ arm: OC_VANILLA, task, config, ctx, cwd: '/w', resume: { sessionId: null, prompt: 'Seconds.' } });
  assert.deepEqual(b.args.slice(-2), ['-c', 'Seconds.']);
  assert.equal(oc.buildCommand({ arm: OC_VANILLA, task, config, ctx, cwd: '/w' }).args.includes('-s'), false);
});

test('an opencode run asks, is answered, resumes by session id and keeps both streams', async () => {
  const s = setup();
  try {
    const r = await executeRun({ arm: OC_VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.turns, 2);
    assert.equal(r.interjections, 1);
    assert.deepEqual(r.questions[0].matched, ['unit']);
    assert.equal(r.finalText, 'Done. I assumed seconds.');
    assert.equal(r.assumptionsStated, true);
    const t2 = JSON.parse(fs.readFileSync(path.join(s.probe, 'started-2.json'), 'utf8'));
    assert.deepEqual(t2.args.slice(-3), ['-s', SID, 'Seconds.']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.probe, 'started-1.json'), 'utf8')).args.includes('-s'), false);
    assert.equal(t2.credentials[0], '[bench]', 'the credential file is there for the resumed turn');
    const one = fs.readFileSync(path.join(s.outDir, 'stream-1.jsonl'), 'utf8');
    const two = fs.readFileSync(path.join(s.outDir, 'stream-2.jsonl'), 'utf8');
    assert.equal(fs.readFileSync(path.join(s.outDir, 'stream.jsonl'), 'utf8'), one + two);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
  } finally { s.cleanup(); }
});
