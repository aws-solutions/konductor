// SPDX-License-Identifier: Apache-2.0
'use strict';

// Keep-or-prune stages 2 to 4 (bench/cap/units.js): the unit lists of agent files, SOPs and always-loaded context, on a
// small made-up tree and on this checkout. Free: files only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { listUnits, unitManifest, renderUnitMap, STAGE_OF_KIND, ENTRY_AGENTS } = require('../../cap/units.js');

const REPO = path.join(__dirname, '..', '..', '..');
const spec = (name, { prompt = `You are ${name}.`, skills = [], sops = [], contexts = [], subagents = [] } = {}) => JSON.stringify({
  name, config: { description: `${name} does things`, systemPrompt: prompt },
  dependencies: { skills: { skillNames: skills }, agentSops: { agentSopNames: sops }, context: { contextNames: contexts }, subagents: { agentNames: subagents } },
});

/** A tree with an orchestrator, two specialists (one listed by nobody), two SOPs and two context files. */
function tree() {
  const root = tmp();
  write(path.join(root, 'agents', 'konductor.agent-spec.json'), spec('konductor', { sops: ['k-review'], contexts: ['k-core-rules.md', 'k-shared.md'], subagents: ['k-dev'] }));
  write(path.join(root, 'agents', 'k-dev.agent-spec.json'), spec('k-dev', { contexts: ['k-core-rules.md'], sops: ['k-review'] }));
  write(path.join(root, 'agents', 'k-lonely.agent-spec.json'), spec('k-lonely'));
  write(path.join(root, 'agent-sops', 'k-review.sop.md'), '# Review\n\n## Overview\n\nReview a change.\n');
  write(path.join(root, 'agent-sops', 'k-unused.sop.md'), '# Unused\n\n## Overview\n\nNobody lists me.\n');
  write(path.join(root, 'context', 'k-core-rules.md'), '# Rules\n\nAlways say what you did.\n');
  write(path.join(root, 'context', 'k-shared.md'), '# Shared\n\nShared text.\n');
  return root;
}

test('each stage lists its own kind: 2 agent files, 3 SOPs, 4 always-loaded context', () => {
  assert.deepEqual(STAGE_OF_KIND, { agent: 2, sop: 3, context: 4 });
  const root = tree();
  try {
    assert.deepEqual(listUnits({ repo: root, kind: 'agent' }).map((u) => u.id), ['agent:k-dev', 'agent:k-lonely', 'agent:konductor']);
    assert.deepEqual(listUnits({ repo: root, kind: 'sop' }).map((u) => u.id), ['sop:k-review', 'sop:k-unused']);
    assert.deepEqual(listUnits({ repo: root, kind: 'context' }).map((u) => u.id), ['context:k-core-rules', 'context:k-shared']);
    assert.throws(() => listUnits({ repo: root, kind: 'skill' }), /stage 1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an agent unit: who delegates to it, its drop arm is the stub agent, and an entry agent has no drop arm', () => {
  const root = tree();
  try {
    const [dev, lonely, konductor] = listUnits({ repo: root, kind: 'agent' });
    assert.deepEqual(dev.listedBy, ['konductor']);
    assert.equal(dev.ablation.how, 'stub');
    assert.equal(dev.ablation.command, 'cap variant --drop agent:k-dev');
    assert.equal(dev.selection.test, 'delegation');
    assert.equal(dev.status, 'needs baseline');
    assert.deepEqual(lonely.listedBy, []);
    assert.match(lonely.status, /^unreachable/);
    assert.ok(ENTRY_AGENTS.includes('konductor'));
    assert.equal(konductor.ablation, null);
    assert.match(konductor.status, /^entry agent/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a SOP unit is user-invoked; a context unit is in every session of each agent that lists it', () => {
  const root = tree();
  try {
    const [review, unused] = listUnits({ repo: root, kind: 'sop' });
    assert.deepEqual(review.listedBy, ['k-dev', 'konductor']);
    assert.equal(review.selection.test, 'none: user-invoked');
    assert.equal(review.ablation.how, 'remove file and lists');
    assert.match(unused.status, /^unreachable/);
    const [rules, shared] = listUnits({ repo: root, kind: 'context' });
    assert.deepEqual(rules.listedBy, ['k-dev', 'konductor']);
    assert.equal(rules.selection.test, 'none: always loaded');
    assert.equal(rules.perSession.estTokens, rules.estTokens);
    assert.equal(rules.perSession.agents, 2);
    assert.deepEqual(shared.listedBy, ['konductor']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the unit hash moves when its text moves, and an agent unit hashes its spec file', () => {
  const root = tree();
  try {
    const before = unitManifest({ repo: root, kind: 'context', name: 'k-shared' });
    assert.deepEqual(before.files, ['context/k-shared.md']);
    fs.appendFileSync(path.join(root, 'context', 'k-shared.md'), 'More.\n');
    assert.notEqual(unitManifest({ repo: root, kind: 'context', name: 'k-shared' }).sha256, before.sha256);
    const agent = unitManifest({ repo: root, kind: 'agent', name: 'k-dev' });
    assert.deepEqual(agent.files, ['agents/k-dev.agent-spec.json']);
    assert.match(agent.text, /You are k-dev\./);
    assert.throws(() => unitManifest({ repo: root, kind: 'sop', name: 'nope' }), /no sop named nope/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('targeted tasks come from a coverage result when given, and the map renders one row per unit', () => {
  const root = tree();
  try {
    const coverage = { units: [{ id: 'sop:k-review', targeted: { dev: ['t2-a'], heldOut: ['t2-b'] }, controls: ['t2-c'] }] };
    const units = listUnits({ repo: root, kind: 'sop', coverage });
    assert.deepEqual(units[0].tasks, { targeted: ['t2-a', 't2-b'], heldOut: ['t2-b'], controls: ['t2-c'] });
    assert.equal(units[1].tasks, null);
    const md = renderUnitMap({ kind: 'sop', units });
    assert.match(md, /^# Stage 3 unit map: SOPs/m);
    assert.match(md, /\| sop:k-review \|/);
    assert.equal(md.split('\n').filter((l) => /^\| sop:/.test(l)).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('this checkout: 11 agent files (3 entry agents), 19 SOPs and 5 context files, and the unlisted digest is flagged', () => {
  const agents = listUnits({ repo: REPO, kind: 'agent' });
  assert.equal(agents.length, 11);
  assert.equal(agents.filter((u) => u.entry).length, 3);
  assert.equal(listUnits({ repo: REPO, kind: 'sop' }).length, 19);
  const contexts = listUnits({ repo: REPO, kind: 'context' });
  assert.equal(contexts.length, 5);
  assert.match(contexts.find((u) => u.name === 'k-coordinator-digest').status, /^unreachable/);
});
