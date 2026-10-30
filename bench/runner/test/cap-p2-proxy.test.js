// SPDX-License-Identifier: Apache-2.0
'use strict';

// Trigger proxy: what a model is shown, how retrieval failures are told apart from judgment failures, and where the
// surface comes from. A fake model answers by stage; no credits are spent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { writeFiles, spec } = require('./cap-helpers.js');
const { kiroSurface, opencodeSurface, recordedStartup } = require('../../cap/surface.js');
const { runProxy, proxySupported, summarizeProxy } = require('../../cap/proxy.js');
const { scoreTrigger } = require('../../cap/score.js');

function tree() {
  const root = tmp();
  writeFiles(root);
  write(path.join(root, 'skills/delegation-protocol/SKILL.md'), '---\nname: delegation-protocol\ndescription: Use when spawning any subagent or deciding who should handle a task.\ntags: [agents]\n---\n\n# Delegation\n');
  const specPath = path.join(root, 'agents/konductor.agent-spec.json');
  const s = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  s.dependencies.skills.skillNames = ['alpha', 'delta', 'delegation-protocol'];
  s.config.systemPrompt = 'Orchestrate the work.\n\nFor every subagent call use the delegation-protocol skill.\n\nBe brief.';
  fs.writeFileSync(specPath, JSON.stringify(s));
  return { root, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// ---- surface ----

test('the kiro surface is the acting agent\'s skill filter over the base tree, with the skill-related prompt paragraphs', () => {
  const t = tree();
  try {
    const s = kiroSurface({ baseDir: t.root, actingAgent: 'konductor' });
    assert.equal(s.runtime, 'kiro-cli');
    assert.deepEqual(s.skillFilter, ['alpha', 'delta', 'delegation-protocol']);
    assert.deepEqual(s.records.map((r) => r.name), ['alpha', 'delegation-protocol', 'delta']);
    assert.equal(s.source, 'agent spec at the base ref');
    assert.match(s.promptExcerpt, /delegation-protocol skill/);
    assert.doesNotMatch(s.promptExcerpt, /Be brief/);
    assert.throws(() => kiroSurface({ baseDir: t.root, actingAgent: 'nobody' }), /no agent spec named "nobody"/);
    assert.equal(kiroSurface({ baseDir: t.root, actingAgent: 'konductor', excerpt: false }).promptExcerpt, '');
  } finally { t.done(); }
});

test('a surface read from a run takes the recorded filter, not the spec', () => {
  const t = tree();
  try {
    const runDir = path.join(t.root, 'run');
    write(path.join(runDir, 'run-config.json'), JSON.stringify({ arms: [
      { id: 'vanilla', startupResources: { runtime: 'kiro-cli', builtin: true } },
      { id: 'base', startupResources: { runtime: 'kiro-cli', skillFilter: ['alpha', 'ghost'], sopPromptFilter: ['k-plan'] } },
    ] }));
    assert.deepEqual(recordedStartup(runDir, 'base').skillFilter, ['alpha', 'ghost']);
    const s = kiroSurface({ baseDir: t.root, actingAgent: 'konductor', fromRun: runDir, armName: 'base' });
    assert.deepEqual(s.records.map((r) => r.name), ['alpha'], 'ghost has no file in the tree');
    assert.deepEqual(s.missing, ['ghost']);
    assert.match(s.source, /run-config startupResources of arm base/);
    assert.throws(() => recordedStartup(runDir, 'nope'), /no arm "nope"/);
    assert.throws(() => kiroSurface({ baseDir: t.root, fromRun: runDir, armName: 'vanilla' }), /no recorded skill filter/);
  } finally { t.done(); }
});

test('the opencode surface is the whole skill index, from the recorded names when a run is given', () => {
  const t = tree();
  try {
    const all = opencodeSurface({ baseDir: t.root });
    assert.equal(all.runtime, 'opencode');
    assert.deepEqual(all.skills.map((s) => s.name), ['alpha', 'beta', 'delegation-protocol', 'delta', 'gamma']);
    const runDir = path.join(t.root, 'run');
    write(path.join(runDir, 'run-config.json'), JSON.stringify({ arms: [{ id: 'oc-base', startupResources: { runtime: 'opencode', skillNames: ['alpha', 'beta'] } }] }));
    assert.deepEqual(opencodeSurface({ baseDir: t.root, fromRun: runDir, armName: 'oc-base' }).skills.map((s) => s.name), ['alpha', 'beta']);
  } finally { t.done(); }
});

// ---- the kiro proxy ----

const searchReply = (...searches) => JSON.stringify({ searches });
const pickReply = (...names) => JSON.stringify({ get_skill: names });

function fakeModel(handler) {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    const stage = prompt.includes('find_skills returned') ? 3 : prompt.includes('Your skills') ? 'oc' : 1;
    const c = { model, prompt, stage, n: calls.length };
    calls.push(c);
    const out = handler(c);
    return typeof out === 'string' ? { text: out, credits: 0.1, latencyMs: 5 } : { text: '', credits: 0.1, latencyMs: 5, ...out };
  };
  fn.calls = calls;
  return fn;
}

const Q = (id, expect, text = `request ${id}`, extra = {}) => ({ id, text, expect, ...extra });

async function kiroRun(queries, handler, over = {}) {
  const t = tree();
  try {
    const surface = kiroSurface({ baseDir: t.root, actingAgent: 'konductor' });
    const caller = fakeModel(handler);
    const r = await runProxy({ harness: 'kiro-cli', capName: 'delegation-protocol', queries, reps: 1, surface, caller, model: 'm', concurrency: 1, ...over });
    return { r, caller, surface };
  } finally { t.done(); }
}

test('a hit: the search finds the skill and the second call picks it', async () => {
  const { r, caller } = await kiroRun([Q('q1', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: 'delegat' }) : pickReply('delegation-protocol')));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hit, true);
  assert.equal(r.rows[0].failure, null);
  assert.equal(r.rows[0].retrieved, true);
  assert.equal(caller.calls.length, 2);
  assert.ok(Math.abs(r.spent - 0.2) < 1e-9);
});

test('a retrieval failure: the capability exists but the search words do not occur in it; no second call is spent', async () => {
  const { r, caller } = await kiroRun([Q('q1', 'load')], () => searchReply({ keyword: 'delegate' }));
  assert.equal(r.rows[0].hit, false);
  assert.equal(r.rows[0].failure, 'retrieval');
  assert.equal(r.rows[0].retrieved, false);
  assert.equal(caller.calls.length, 1);
});

test('a retrieval failure also when other skills were returned and the model picked one of them', async () => {
  const { r, caller } = await kiroRun([Q('q1', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: 'alpha' }) : pickReply('alpha')));
  assert.equal(r.rows[0].hit, false);
  assert.equal(r.rows[0].failure, 'retrieval');
  assert.deepEqual(r.rows[0].candidates, ['alpha']);
  assert.equal(r.rows[0].retrieved, false);
  assert.deepEqual(r.rows[0].fired, ['alpha']);
  assert.equal(caller.calls.length, 2);
  const none = await kiroRun([Q('q2', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: 'alpha' }) : pickReply()));
  assert.equal(none.r.rows[0].failure, 'retrieval', 'the candidates lacked the skill, so picking nothing is not a judgment failure');
});

test('a judgment failure: the skill was in the candidates and the model did not pick it', async () => {
  const { r } = await kiroRun([Q('q1', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: 'delegat' }) : pickReply()));
  assert.equal(r.rows[0].failure, 'judgment');
  assert.equal(r.rows[0].retrieved, true);
});

test('no search at all is its own failure, and costs one call', async () => {
  const { r, caller } = await kiroRun([Q('q1', 'load')], () => searchReply());
  assert.equal(r.rows[0].failure, 'no-search');
  assert.equal(caller.calls.length, 1);
});

test('a false trigger: an expect:none query where the capability is picked; other picks are what fired besides it', async () => {
  const { r } = await kiroRun([Q('q1', 'none')], (c) => (c.stage === 1 ? searchReply({ name: 'del' }) : pickReply('delegation-protocol', 'delta')));
  assert.equal(r.rows[0].hit, true);
  assert.equal(r.rows[0].failure, 'false-trigger');
  assert.deepEqual(r.rows[0].fired, ['delta']);
});

test('picks outside the candidate list are ignored and noted', async () => {
  const { r } = await kiroRun([Q('q1', 'none')], (c) => (c.stage === 1 ? searchReply({ keyword: 'alpha' }) : pickReply('delegation-protocol', 'alpha')));
  assert.equal(r.rows[0].hit, false);
  assert.deepEqual(r.rows[0].invalidPicks, ['delegation-protocol']);
  assert.deepEqual(r.rows[0].fired, ['alpha']);
});

test('several searches are unioned, a bad search is recorded and the rest still count', async () => {
  const { r } = await kiroRun([Q('q1', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: '' }, { tag: 'agents' }, { keyword: 'zzz' }) : pickReply('delegation-protocol')));
  assert.equal(r.rows[0].hit, true);
  assert.deepEqual(r.rows[0].candidates, ['delegation-protocol']);
  assert.equal(r.rows[0].searchErrors.length, 1);
  assert.match(r.rows[0].searchErrors[0], /keyword must not be empty/);
});

test('the first call shows the tool contract, the filter size and the prompt excerpt, and hides skill names', async () => {
  const { caller } = await kiroRun([Q('q1', 'load', 'Please split this feature across the team')], () => searchReply());
  const p = caller.calls[0].prompt;
  assert.match(p, /find_skills/);
  assert.match(p, /substring\/exact filters, not a ranker/);
  assert.match(p, /3 skills/);
  assert.match(p, /delegation-protocol skill/, 'the excerpt of the system prompt is included');
  assert.match(p, /Please split this feature across the team/);
  assert.doesNotMatch(p, /Use when spawning any subagent/, 'descriptions are not shown before the search');
  assert.doesNotMatch(p, /\balpha\b/);
});

test('the second call shows the candidates the search returned, with descriptions', async () => {
  const { caller } = await kiroRun([Q('q1', 'load')], (c) => (c.stage === 1 ? searchReply({ keyword: 'delegat' }) : pickReply()));
  const p = caller.calls[1].prompt;
  assert.match(p, /find_skills returned/);
  assert.match(p, /Use when spawning any subagent/);
  assert.doesNotMatch(p, /"name":"alpha"/);
});

test('an unusable reply is retried once; a second bad reply makes an error row, not a miss', async () => {
  let n = 0;
  const { r, caller } = await kiroRun([Q('q1', 'load')], () => { n++; return 'I would search for delegation'; });
  assert.equal(r.rows[0].failure, 'error');
  assert.equal(r.rows[0].hit, false);
  assert.equal(caller.calls.length, 2);
  assert.match(caller.calls[1].prompt, /not valid JSON/);
  assert.equal(n, 2);
  const s = summarizeProxy(r.rows);
  assert.equal(s.errors, 1);
  assert.equal(s.retrievalFailures, 0);
});

test('a model error becomes an error row and keeps its credits', async () => {
  const { r } = await kiroRun([Q('q1', 'load')], () => ({ error: 'timed out', credits: 0.3 }));
  assert.equal(r.rows[0].failure, 'error');
  assert.ok(Math.abs(r.spent - 0.3) < 1e-9);
});

test('repeats multiply the rows, and a credit budget stops further queries', async () => {
  const qs = [Q('q1', 'load'), Q('q2', 'none')];
  const full = await kiroRun(qs, () => searchReply(), { reps: 2 });
  assert.equal(full.r.rows.length, 4);
  assert.deepEqual(full.r.rows.map((x) => x.rep).sort(), [1, 1, 2, 2]);
  const capped = await kiroRun(qs, () => searchReply(), { reps: 2, budgetCredits: 0.25 });
  assert.equal(capped.r.rows.length + capped.r.skipped.length, 4);
  assert.ok(capped.r.skipped.length >= 1);
  assert.ok(capped.r.spent <= 0.4 + 1e-9);
});

test('the summary splits expect:load misses into retrieval, judgment and no-search, and counts false triggers', async () => {
  const handler = (c) => {
    const q = /request (\w+)/.exec(c.prompt)[1];
    if (c.stage === 1) return q === 'a' ? searchReply({ keyword: 'delegate' }) : q === 'd' ? searchReply() : searchReply({ keyword: 'delegat' });
    return q === 'c' ? pickReply() : pickReply('delegation-protocol');
  };
  const { r } = await kiroRun([Q('a', 'load'), Q('b', 'load'), Q('c', 'load'), Q('d', 'load'), Q('e', 'none')], handler);
  const s = summarizeProxy(r.rows);
  assert.deepEqual([s.retrievalFailures, s.judgmentFailures, s.noSearch, s.falseTriggers, s.errors], [1, 1, 1, 1, 0]);
  const sc = scoreTrigger(r.rows);
  assert.deepEqual([sc.tp, sc.fn, sc.fp], [1, 3, 1]);
});

test('only skills can be proxied on kiro; skills and SOPs on opencode; agents and context need live mode', () => {
  assert.equal(proxySupported('skill:x', 'kiro-cli').ok, true);
  assert.equal(proxySupported('sop:x', 'opencode').ok, true);
  assert.match(proxySupported('sop:x', 'kiro-cli').reason, /live mode/);
  assert.match(proxySupported('agent:x', 'opencode').reason, /live mode/);
  assert.match(proxySupported('context:x', 'kiro-cli').reason, /live mode/);
});

// ---- the opencode proxy ----

test('opencode: one call per query repeat with the real skill index in the prompt; the reply names the skills it would load', async () => {
  const t = tree();
  try {
    const surface = opencodeSurface({ baseDir: t.root });
    const caller = fakeModel((c) => (/request q1/.test(c.prompt) ? JSON.stringify({ skill: ['delegation-protocol', 'alpha'] }) : JSON.stringify({ skill: [] })));
    const r = await runProxy({ harness: 'opencode', capName: 'delegation-protocol', queries: [Q('q1', 'load'), Q('q2', 'none')], reps: 1, surface, caller, model: 'm', concurrency: 1 });
    assert.equal(caller.calls.length, 2);
    for (const name of ['alpha', 'beta', 'delegation-protocol', 'delta', 'gamma']) assert.match(caller.calls[0].prompt, new RegExp(`- ${name}:`));
    assert.match(caller.calls[0].prompt, /Use when spawning any subagent/);
    assert.deepEqual(r.rows.map((x) => [x.queryId, x.hit, x.fired]), [['q1', true, ['alpha']], ['q2', false, []]]);
    assert.equal(r.rows[0].retrieved, true, 'no retrieval stage on opencode');
    assert.equal(r.rows[1].failure, null);
  } finally { t.done(); }
});

test('opencode names that are not in the index are ignored', async () => {
  const t = tree();
  try {
    const surface = opencodeSurface({ baseDir: t.root });
    const r = await runProxy({ harness: 'opencode', capName: 'alpha', queries: [Q('q1', 'load')], reps: 1, surface, caller: fakeModel(() => JSON.stringify({ skill: ['made-up', 'alpha'] })), model: 'm', concurrency: 1 });
    assert.equal(r.rows[0].hit, true);
    assert.deepEqual(r.rows[0].invalidPicks, ['made-up']);
  } finally { t.done(); }
  assert.ok(spec);
});
