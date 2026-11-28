// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-172: the delegation request sets shipped for the eight stage 2 agents (cap/unit-baselines/agent-*/delegation.json).
// They are drafts (no second-family review, no person's sign-off), so every result built from them says so. Free: the
// stub runs, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { requestProblems, runDelegation } = require('../../cap/delegation.js');
const { listUnits, UNIT_BASELINES_DIR } = require('../../cap/units.js');

const REPO = path.join(__dirname, '..', '..', '..');
// The reachable, non-entry agents: the ones an orchestrator can hand work to.
const AGENTS = listUnits({ repo: REPO, kind: 'agent' }).filter((u) => !u.entry && !/^unreachable/.test(u.status)).map((u) => u.name);
const setOf = (agent) => JSON.parse(fs.readFileSync(path.join(UNIT_BASELINES_DIR, `agent-${agent}`, 'delegation.json'), 'utf8'));

test('every reachable agent has a request set with no problem, 4 requests to delegate and 4 to keep away', () => {
  assert.equal(AGENTS.length, 8, AGENTS.join(', '));
  for (const agent of AGENTS) {
    const set = setOf(agent);
    assert.deepEqual(requestProblems(set, agent), [], agent);
    assert.equal(set.requests.filter((r) => r.expect === 'delegate').length, 4, agent);
    assert.equal(set.requests.filter((r) => r.expect === 'none').length, 4, agent);
  }
});

test('no prompt is shared between two sets, so a request cannot be right for two agents', () => {
  const seen = new Map();
  for (const agent of AGENTS) {
    for (const r of setOf(agent).requests) {
      const key = r.prompt.trim().toLowerCase();
      assert.ok(!seen.has(key) || seen.get(key) === agent, `${agent} ${r.id} repeats a prompt of ${seen.get(key)}`);
      seen.set(key, agent);
    }
  }
});

test('on the stub, the correct behaviour scores 1 and 1, every result is marked a draft, and no set claims a reviewer', () => {
  const dir = tmp();
  try {
    for (const agent of AGENTS) {
      const { result } = runDelegation({ repo: REPO, agent, runId: 'stub-sets', outDir: dir, reps: 1 });
      assert.equal(result.precision, 1, agent);
      assert.equal(result.recall, 1, agent);
      assert.equal(result.frozen, false, `${agent}: a draft set must not read as reviewed`);
      assert.equal(setOf(agent).reviewedBy, null, agent);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
