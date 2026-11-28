// SPDX-License-Identifier: Apache-2.0
'use strict';

// DEBT D-172: the briefs of the eight stage 2 agent units (cap/unit-baselines/agent-*/briefs.json), 16 each in two
// batches of 8, so `cap unit-author` can write their baselines once the owner sets a cap. Free: no model call.
// These are drafts by one writer; the baseline writer (glm-5) and reviewer (deepseek-3.2) are other families.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadBriefs, DEFAULT_FAMILIES } = require('../../cap/unitauthor.js');
const { listUnits, UNIT_BASELINES_DIR } = require('../../cap/units.js');

const REPO = path.join(__dirname, '..', '..', '..');
const AGENTS = listUnits({ repo: REPO, kind: 'agent' }).filter((u) => !u.entry && !/^unreachable/.test(u.status)).map((u) => u.name);
const load = (agent) => loadBriefs(path.join(UNIT_BASELINES_DIR, `agent-${agent}`, 'briefs.json'), `agent:${agent}`);

test('each of the 8 reachable agents has 16 briefs in two batches of 8, written by other families than Claude', () => {
  assert.equal(AGENTS.length, 8, AGENTS.join(', '));
  for (const agent of AGENTS) {
    const b = load(agent);
    assert.deepEqual(b.batches, ['b1', 'b2'], agent);
    assert.equal(b.briefs.length, 16, agent);
    assert.deepEqual(b.families, DEFAULT_FAMILIES, agent);
  }
});

test('ids are t01 to t16 in order, every field is filled, and the good answer is not the situation', () => {
  for (const agent of AGENTS) {
    const { briefs } = load(agent);
    assert.deepEqual(briefs.map((x) => x.id), Array.from({ length: 16 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`), agent);
    for (const x of briefs) {
      assert.ok(typeof x.section === 'string' && x.section.trim().length > 2, `${agent} ${x.id} section`);
      for (const f of ['situation', 'good']) assert.ok(typeof x[f] === 'string' && x[f].trim().length > 30, `${agent} ${x.id} ${f}`);
      assert.notEqual(x.situation, x.good, `${agent} ${x.id}`);
      assert.equal(x.batch, Number(x.id.slice(1)) <= 8 ? 'b1' : 'b2', `${agent} ${x.id} batch`);
    }
  }
});

test('each unit ends with one plain control, no situation names the agent under test, and no situation is shared by two briefs', () => {
  const seen = new Map();
  for (const agent of AGENTS) {
    const { briefs } = load(agent);
    const controls = briefs.filter((x) => x.section === 'Control');
    assert.deepEqual(controls.map((x) => x.id), ['t16'], agent);
    for (const x of briefs) {
      assert.ok(!x.situation.toLowerCase().includes(agent), `${agent} ${x.id} names the agent`);
      const key = x.situation.trim().toLowerCase();
      assert.ok(!seen.has(key), `${agent} ${x.id} repeats ${seen.get(key)}`);
      seen.set(key, `${agent} ${x.id}`);
    }
  }
});

test('batch 1 of each unit spans at least two sections of the agent file, so it does not test one rule eight times', () => {
  for (const agent of AGENTS) {
    const { briefs } = load(agent);
    const sections = new Set(briefs.filter((x) => x.batch === 'b1').map((x) => x.section));
    assert.ok(sections.size >= 2, `${agent}: batch 1 covers ${[...sections].join(', ')}`);
  }
});
