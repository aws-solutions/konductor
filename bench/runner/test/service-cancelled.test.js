// SPDX-License-Identifier: Apache-2.0
'use strict';

// A turn the model service cancels (stopReason "cancelled", no error text anywhere) is infra, not an agent failure:
// it gets infraError and the serviceCancelled flag when built, older results are read the same way by the report, and
// the pilot table gives it no score instead of the near-zero score of a run that wrote nothing (Fable review, 2026-11-23).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tmp, write, mkResult } = require('./helpers.js');
const { buildResult, serviceCancelled } = require('../lib/result.js');
const { outcomeOf } = require('../../report/aggregate.js');
const { pilotRows } = require('../../scenarios/pilot-table.js');

const base = (agg, exec = {}) => ({
  arm: { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'kiro-cli', runtime: 'kiro-cli', vanilla: true },
  task: { id: 't', class: 'design' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine: 'v3' },
  exec: { timedOut: false, exitCode: 1, wallClockMs: 1, ...exec }, agg: { meteringEntries: 1, credits: 1, toolCalls: 8, workToolCalls: 8, subagentCalls: 0, toolNames: {}, ...agg },
  session: null, checks: [], transcript: null, env: {},
});

test('serviceCancelled: a cancelled stop with no error text, and nothing else', () => {
  assert.equal(serviceCancelled({ stopReason: 'cancelled', error: null, infraError: null }), true);
  assert.equal(serviceCancelled({ stopReason: 'cancelled', error: 'killed by the credit limit' }), false);
  assert.equal(serviceCancelled({ stopReason: 'cancelled', infraError: 'login not valid' }), false);
  assert.equal(serviceCancelled({ stopReason: 'end_turn' }), false);
  assert.equal(serviceCancelled({ stopReason: 'cancelled', flags: ['creditLimit'] }), false, 'the bench stopped it, not the service');
  assert.equal(serviceCancelled(null), false);
});

test('buildResult marks a service-cancelled turn as infra', () => {
  const r = buildResult(base({ runFinishedStatus: 'error', stopReason: 'cancelled' }));
  assert.equal(r.status, 'error');
  assert.match(r.infraError, /service cancelled the turn/);
  assert.ok(r.flags.includes('serviceCancelled'));
  const ok = buildResult(base({ runFinishedStatus: 'success', stopReason: 'end_turn' }, { exitCode: 0 }));
  assert.equal(ok.infraError, null);
});

test('the report reads an older cancelled result as infraError, so it leaves the quality score', () => {
  assert.equal(outcomeOf(mkResult({ status: 'error', stopReason: 'cancelled', infraError: null, error: null })), 'infraError');
  assert.equal(outcomeOf(mkResult({ status: 'error', stopReason: 'end_turn', error: 'exit 1' })), 'error');
});

test('the pilot table gives a cancelled run no score and a cancelled flag, not broken or too-hard', () => {
  const root = tmp();
  const pack = path.join(root, 'pack');
  write(path.join(pack, 't5', 't5-x.json'), `${JSON.stringify({ id: 't5-x', prompt: 'Do it.', fixture: 't5-x', hidden: 't5-x', authorship: { model: 'gpt-5.6-luna' } })}\n`);
  const d = path.join(root, 'w', 'vanilla', 't5-x', '1');
  write(path.join(d, 'result.json'), JSON.stringify(mkResult({ armId: 'vanilla', taskId: 't5-x', replicate: 1, status: 'error', stopReason: 'cancelled', infraError: null, error: null, checks: [{ type: 'tests', passed: false, tests: { passed: 0, total: 4 } }, { type: 'cmd', kind: 'substance', passed: true }] })));
  write(path.join(d, 'stream.jsonl'), '');
  const [row] = pilotRows([path.join(root, 'w')], { packDir: pack });
  assert.equal(row.score, null);
  assert.match(row.flags.cancelled, /cancelled by the model service/);
  assert.equal(row.flags.broken, undefined);
  assert.equal(row.flags['too-hard'], undefined);
});
