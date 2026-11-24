// SPDX-License-Identifier: Apache-2.0
// FW-18 step 6 (DEBT D-212): a harness reads its own run options before a run (runOptions) and, when the agent signs
// its own model calls, its credentials (runCredentials), so run-cmd.js no longer branches on runtime names for them.
// The rules are the ones run-cmd.js applied before the move. No model call, no credentials read.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESSES } = require('../lib/harness/index.js');

const cc = HARNESSES['claude-code'];
const st = HARNESSES.strands;

test('claude-code runOptions: the per-run budget and the region, Bedrock model ids only', () => {
  assert.deepEqual(cc.runOptions({ opts: {} }), { runBudgetUsd: null, region: cc.REGION });
  assert.deepEqual(cc.runOptions({ opts: { 'run-budget-usd': '2', 'aws-region': 'us-west-2' } }), { runBudgetUsd: 2, region: 'us-west-2' });
  assert.throws(() => cc.runOptions({ opts: { 'run-budget-usd': '0' } }), /--run-budget-usd must be a positive number/);
});

test('claude-code runCredentials: a plant control needs no keys; otherwise the environment must hold them', () => {
  assert.deepEqual(cc.runCredentials({ opts: {}, deps: {}, env: { AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' } }), { creds: null });
  assert.throws(() => cc.runCredentials({ opts: {}, deps: {}, env: {} }));
});

test('strands runOptions: the fake model takes no credentials and refuses --aws-profile; a bedrock model needs one', () => {
  assert.deepEqual(st.runOptions({ opts: { model: 'fake:/x.json' }, deps: {} }), { stModel: null, stCreds: null });
  assert.throws(() => st.runOptions({ opts: { model: 'fake:/x.json', 'aws-profile': 'p' }, deps: {} }), /applies to a Strands run only with a bedrock: model/);
  const id = Object.keys(require('../../physical/strands/plant_strands/bedrock_models.json').models)[0];
  assert.throws(() => st.runOptions({ opts: { model: `bedrock:${id}` }, deps: {} }), /needs --aws-profile NAME/);
});

test('kiro-cli and opencode take no run options of their own', () => {
  assert.equal(HARNESSES['kiro-cli'].runOptions, undefined);
  assert.equal(HARNESSES.opencode.runOptions, undefined);
});

test('claude-code checkFlags and prepareOnlyCheck: its effort words, and prepare-only runs its arms alone', () => {
  assert.doesNotThrow(() => cc.checkFlags({ opts: {}, defaultEffort: cc.EFFORT_LEVELS[0] }));
  assert.throws(() => cc.checkFlags({ opts: { effort: 'nope' }, defaultEffort: cc.EFFORT_LEVELS[0] }));
  assert.throws(() => cc.prepareOnlyCheck({ opts: {}, runtimes: ['claude-code', 'kiro-cli'] }), /prepare them apart from kiro-cli arms/);
});

test('opencode credentialsFile: --aws-creds-file is needed and must hold the profile', () => {
  const oc = HARNESSES.opencode;
  assert.throws(() => oc.credentialsFile({ opts: {} }), /--aws-creds-file is required for opencode arms/);
  const fs = require('node:fs');
  const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'oc-creds-'));
  const file = require('node:path').join(dir, 'credentials');
  fs.writeFileSync(file, '[bench]\naws_access_key_id = k\naws_secret_access_key = s\n');
  try {
    assert.deepEqual(oc.credentialsFile({ opts: { 'aws-creds-file': file } }), { awsCredsFile: file, awsProfile: 'bench' });
    assert.throws(() => oc.credentialsFile({ opts: { 'aws-creds-file': file, 'aws-profile': 'other' } }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  for (const r of ['kiro-cli', 'claude-code', 'strands']) assert.equal(HARNESSES[r].credentialsFile, undefined);
});
