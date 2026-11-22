// SPDX-License-Identifier: Apache-2.0
'use strict';

// Stage 2's selection test, the delegation test (DEBT D-172), on the stub: does the orchestrator hand a request to the
// agent when it should, and keep it away when it should not? Delegations are read from stub kiro-cli streams with the
// runner's own stream code; the score is the trigger scorer's. Free: no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { requestProblems, stubStream, readStream, runStub, scoreDelegation, delegationResult, delegationProblems, runDelegation } = require('../../cap/delegation.js');
const { runUnitStage } = require('../../cap/unitstage.js');

const AGENT = 'k-researcher';
const SET = {
  format_version: 1, agent: AGENT, writtenBy: 'a', reviewedBy: 'b',
  requests: [
    { id: 'd1', prompt: 'Which services read the PAYMENT_TIMEOUT key? Cite file and line.', expect: 'delegate' },
    { id: 'd2', prompt: 'Find where the retry policy for outbound calls is set, in code and IaC.', expect: 'delegate' },
    { id: 'd3', prompt: 'Trace every caller of the legacy date parser across the repo.', expect: 'delegate' },
    { id: 'n1', prompt: 'Rename the variable tmp to total in utils.js.', expect: 'none' },
    { id: 'n2', prompt: 'Write a unit test for add(a, b).', expect: 'none' },
    { id: 'n3', prompt: 'Fix the typo in the README title.', expect: 'none' },
  ],
};

test('a request set needs 3 of each kind and no prompt that names the agent', () => {
  assert.deepEqual(requestProblems(SET, AGENT), []);
  assert.match(requestProblems({ ...SET, requests: SET.requests.slice(1) }, AGENT).join('; '), /at least 3 requests that expect delegate/);
  const named = { ...SET, requests: [...SET.requests, { id: 'x', prompt: 'Ask k-researcher to look.', expect: 'delegate' }] };
  assert.match(requestProblems(named, AGENT).join('; '), /x names the agent/);
});

test('a stub stream with a subagent call reads back as a delegation through the runner stream code', () => {
  assert.deepEqual(readStream(stubStream({ target: AGENT })), { [AGENT]: 1 });
  assert.deepEqual(readStream(stubStream({ target: null })), {});
});

test('the correct stub scores precision and recall 1; always and never miss in the expected way', () => {
  const dir = tmp();
  try {
    const score = (behaviour) => scoreDelegation(runStub({ agent: AGENT, set: SET, runId: 'stub-d', dir: path.join(dir, behaviour), behaviour }), AGENT);
    const ok = score('correct');
    assert.deepEqual([ok.score.precision.value, ok.score.recall.value], [1, 1]);
    const always = score('always');
    assert.deepEqual([always.score.precision.value, always.score.recall.value], [0.5, 1]);
    const never = score('never');
    assert.deepEqual([never.score.precision.value, never.score.recall.value], [null, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a stub that hands the work to another agent is a miss, and the wrong target is named', () => {
  const dir = tmp();
  try {
    const s = scoreDelegation(runStub({ agent: AGENT, set: SET, runId: 'stub-d', dir, behaviour: 'other' }), AGENT);
    assert.equal(s.score.recall.value, 0);
    assert.deepEqual(s.wrongTargets, { 'k-developer': 9 });
    assert.throws(() => runStub({ agent: AGENT, set: SET, runId: 'real', dir, behaviour: 'correct' }), /stub/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the delegation result is checked, and a stage 2 record carries it; a context record refuses one', () => {
  const root = tmp();
  try {
    const repo = path.join(root, 'repo');
    const spec = (name, subagents = []) => JSON.stringify({ name, config: { description: 'd', systemPrompt: `You are ${name}.` }, dependencies: { skills: { skillNames: [] }, agentSops: { agentSopNames: [] }, context: { contextNames: ['k-rules.md'] }, subagents: { agentNames: subagents } } });
    write(path.join(repo, 'agents', 'konductor.agent-spec.json'), spec('konductor', [AGENT]));
    write(path.join(repo, 'agents', `${AGENT}.agent-spec.json`), spec(AGENT));
    write(path.join(repo, 'context', 'k-rules.md'), '# Rules\n');
    const baselines = path.join(root, 'unit-baselines');
    write(path.join(baselines, `agent-${AGENT}`, 'delegation.json'), JSON.stringify(SET));
    const { result, file } = runDelegation({ repo, agent: AGENT, runId: 'stub-d', outDir: path.join(root, 'out'), baselinesDir: baselines });
    assert.equal(file, path.join(root, 'out', 'stub-d', 'delegation', `${AGENT}.json`));
    assert.deepEqual(delegationProblems(result), []);
    assert.equal(result.frozen, true, 'a reviewed request set');
    assert.equal(result.requests.delegate, 3);
    assert.deepEqual(delegationProblems({ ...result, recall: 2 }), ['recall must be a rate from 0 to 1']);
    const stage = runUnitStage({ kind: 'agent', name: AGENT, repo, runId: 'stub-d', outDir: path.join(root, 'out'), baselinesDir: baselines, delegation: result }).record;
    assert.equal(stage.delegation.recall, 1);
    assert.throws(() => runUnitStage({ kind: 'context', name: 'k-rules', repo, runId: 'stub-d', outDir: path.join(root, 'out'), baselinesDir: baselines, delegation: result }), /only an agent unit has a delegation result/);
    assert.throws(() => runDelegation({ repo, agent: 'konductor', runId: 'stub-d', outDir: path.join(root, 'out'), baselinesDir: baselines }), /entry agent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
