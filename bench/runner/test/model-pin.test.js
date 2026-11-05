// SPDX-License-Identifier: Apache-2.0
'use strict';

// The model setting an engine v3 stream reports counts as a record of the model, so a run with no session file and no
// rewritten agent file (a kiro-cli run without konductor) can still have its pin checked.

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateStream, mergeAggregates } = require('../lib/stream.js');
const { buildResult } = require('../lib/result.js');

const options = (model) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'config_option_update', configOptions: [{ id: 'mode', currentValue: 'vibe' }, { id: 'model', currentValue: model }, { id: 'effortLevel', currentValue: 'high' }] } } });
const finished = { type: 'runFinished', data: { status: 'success', finalText: 'ok' } };

test('the stream\'s model setting is read: auto is ignored and the last real model wins', () => {
  assert.equal(aggregateStream([options('auto'), options('claude-sonnet-5.5'), finished]).configuredModel, 'claude-sonnet-5.5');
  assert.equal(aggregateStream([options('auto'), finished]).configuredModel, null);
  assert.equal(aggregateStream([finished]).configuredModel, null);
  assert.equal(aggregateStream([options('claude-sonnet-5.5'), options('claude-opus-5'), finished]).configuredModel, 'claude-opus-5');
});

test('turns of one conversation keep the last model setting any of them reported', () => {
  const a = aggregateStream([options('claude-sonnet-5.5'), finished]);
  const b = aggregateStream([finished]);
  assert.equal(mergeAggregates([a, b]).configuredModel, 'claude-sonnet-5.5');
});

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v3' };
const result = (agg) => buildResult({ arm: ARM, task: { id: 't', checks: [] }, replicate: 1, config: CONFIG, exec: { exitCode: 0, timedOut: false }, agg, session: null, checks: [], transcript: { bytes: 1, chars: 1, partial: true }, env: {} });

test('a result records streamModel only when the stream reported one, and the field is described in the schema', () => {
  const withModel = result(aggregateStream([options('claude-sonnet-5.5'), finished]));
  assert.equal(withModel.streamModel, 'claude-sonnet-5.5');
  assert.equal(withModel.sessionModel, null);
  assert.equal('streamModel' in result(aggregateStream([finished])), false);
  const schema = require('../../schema/result.schema.json');
  assert.equal(schema.properties.streamModel.type, 'string');
});
