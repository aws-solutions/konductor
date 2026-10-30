// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap trigger: where the queries come from, how live trigger tasks are materialized and read back, the cross-check
// sample, the report, and the validator rules for trigger tasks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const trig = require('../../cap/trigger.js');
const { scoreTrigger } = require('../../cap/score.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const VALIDATE = path.join(__dirname, '..', '..', 'tasks', 'validate-tasks.js');

const Q = (id, expect, split, extra = {}) => ({ id, text: `A realistic request ${id} about some engineering work`, expect, ...(split ? { split } : {}), ...extra });
const CAP = { id: 'skill:alpha', kind: 'skill', name: 'alpha' };

// ---- queries ----

test('registry queries are filtered by split: train, heldout, or both, and the reserve is never included', () => {
  const e = entry({ trigger: { gen: 1, queries: [Q('t1', 'load', 'train'), Q('t2', 'none', 'train'), Q('h1', 'load', 'heldout'), Q('r1', 'none', 'reserve')] } });
  assert.deepEqual(trig.queriesFromRegistry(e, 'train').map((q) => q.id), ['t1', 't2']);
  assert.deepEqual(trig.queriesFromRegistry(e, 'heldout').map((q) => q.id), ['h1']);
  assert.deepEqual(trig.queriesFromRegistry(e, 'all').map((q) => q.id), ['t1', 't2', 'h1']);
  assert.throws(() => trig.queriesFromRegistry(e, 'bogus'), /--split takes train, heldout or all/);
  assert.throws(() => trig.queriesFromRegistry(entry(), 'all'), /has no trigger queries; add them from a reviewed draft/);
});

test('a draft file supplies queries as they are, without splits', () => {
  const root = tmp();
  try {
    const f = path.join(root, 'd.json');
    write(f, JSON.stringify({ capId: 'skill:alpha', status: 'draft-unreviewed', queries: [{ id: 'd01', text: 'Look at this change', expect: 'load', rationale: 'r' }, { id: 'd02', text: 'Write a poem', expect: 'none', nearMissOf: 'skill:delta', rationale: 'r' }] }));
    const q = trig.queriesFromDraft(f, 'skill:alpha');
    assert.deepEqual(q.map((x) => [x.id, x.expect, x.nearMissOf ?? null, x.split ?? null]), [['d01', 'load', null, null], ['d02', 'none', 'skill:delta', null]]);
    assert.throws(() => trig.queriesFromDraft(f, 'skill:beta'), /draft is for skill:alpha, not skill:beta/);
    write(f, '{ not json');
    assert.throws(() => trig.queriesFromDraft(f, 'skill:alpha'), /cannot read the drafts file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- live tasks ----

test('materialized trigger tasks load, validate and carry the query, the target and a neutral fixture', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = path.join(root, 'tasks');
    const made = trig.materializeTasks({ cap: CAP, queries: [Q('t1', 'load', 'train'), Q('t2', 'none', 'heldout', { nearMissOf: 'skill:delta' })], dir });
    assert.deepEqual(made.map((m) => m.taskId), ['trg-skill-alpha-t1', 'trg-skill-alpha-t2']);
    const tasks = loadTasks(bench, { extraDirs: [dir] });
    const t = tasks.get('trg-skill-alpha-t1');
    assert.equal(t.class, 'trigger');
    assert.deepEqual(t.tiers, ['cap']);
    assert.equal(t.prompt, 'A realistic request t1 about some engineering work');
    assert.equal(t.target, 'alpha');
    assert.deepEqual(t.checks, []);
    assert.deepEqual(t.triggerQuery, { capId: 'skill:alpha', queryId: 't1', split: 'train', expect: 'load' });
    assert.equal(tasks.get('trg-skill-alpha-t2').triggerQuery.split, 'heldout');
    assert.ok(fs.existsSync(path.join(dir, 'fixtures', 'trigger-neutral')));
    assert.ok(fs.readdirSync(path.join(dir, 'fixtures', 'trigger-neutral')).length >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a task id that would be unsafe is rewritten and two queries never share one', () => {
  const root = tmp();
  try {
    const made = trig.materializeTasks({ cap: CAP, queries: [Q('a b/c', 'load'), Q('a-b-c', 'load')], dir: path.join(root, 't') });
    assert.equal(new Set(made.map((m) => m.taskId)).size, 2);
    assert.ok(made.every((m) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(m.taskId)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the validator accepts trigger tasks without the document rules and rejects broken ones', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'tasks');
    trig.materializeTasks({ cap: CAP, queries: [Q('t1', 'load', 'train'), Q('t2', 'none')], dir });
    fs.mkdirSync(path.join(root, 'h'));
    const run = () => spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
    const ok = run();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const f = path.join(dir, 'trg-skill-alpha-t1.json');
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    write(f, JSON.stringify({ ...t, hidden: 'x' }));
    assert.match(run().stderr, /trigger tasks have no hidden directory/);
    write(f, JSON.stringify({ ...t, checks: [{ type: 'file_exists', path: 'a.txt' }] }));
    assert.match(run().stderr, /trigger tasks have no checks/);
    write(f, JSON.stringify({ ...t, tiers: ['lite'] }));
    assert.match(run().stderr, /trigger tasks must have tiers \["cap"\]/);
    write(f, JSON.stringify({ ...t, triggerQuery: undefined }));
    assert.match(run().stderr, /trigger tasks need a triggerQuery/);
    write(f, JSON.stringify({ ...t, prompt: 'Run the k-plan SOP for me' }));
    assert.match(run().stderr, /names a konductor procedure or agent/);
    write(f, JSON.stringify({ ...t, prompt: 'Short ask' }));
    assert.equal(run().status, 0, 'a short prompt is fine for a trigger task');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- reading live results ----

const result = (over = {}) => ({
  status: 'error', replicate: 1, flags: ['earlyStopped'], creditsCensored: true, credits: 0.4,
  triggerQuery: { capId: 'skill:alpha', queryId: 't1', split: 'train', expect: 'load', rep: 1 },
  skillsLoaded: [], skillCallsFailed: 0, targetAttempted: false,
  capInvocation: { delegatedTo: [], findSkillsBytes: 0, requested: [], firstDecision: { kind: 'none', name: null }, identified: [] }, ...over,
});
const withInv = (inv, over = {}) => result({ capInvocation: { ...result().capInvocation, ...inv }, ...over });

test('a skill run is a hit when the skill was loaded or asked for by name, and others that fired are listed', () => {
  assert.equal(trig.liveRow(result({ skillsLoaded: [{ name: 'alpha', via: 'get_skill', count: 1 }] }), CAP).hit, true);
  assert.equal(trig.liveRow(withInv({ requested: ['Alpha'] }), CAP).hit, true, 'asked for but cut off before the answer');
  const miss = trig.liveRow(withInv({ requested: ['frontend-review'] }, { skillsLoaded: [{ name: 'frontend-review', via: 'get_skill', count: 1 }] }), CAP);
  assert.equal(miss.hit, false);
  assert.deepEqual(miss.fired, ['frontend-review']);
  assert.equal(trig.liveRow(result(), CAP).hit, false);
  const r = trig.liveRow(result(), CAP);
  assert.deepEqual([r.queryId, r.expect, r.rep, r.split], ['t1', 'load', 1, 'train']);
});

test('an agent run is a hit when it delegated to that agent; others delegated to are what fired', () => {
  const agent = { id: 'agent:k-architect', kind: 'agent', name: 'k-architect' };
  const row = trig.liveRow(withInv({ delegatedTo: [{ agent: 'k-architect', count: 1 }, { agent: 'k-developer', count: 2 }] }), agent);
  assert.equal(row.hit, true);
  assert.deepEqual(row.fired, ['k-developer']);
  assert.equal(trig.liveRow(withInv({ delegatedTo: [{ agent: 'k-developer', count: 1 }] }), agent).hit, false);
});

test('a SOP run is a hit when it loaded the SOP or the final text pointed at it', () => {
  const sop = { id: 'sop:k-plan', kind: 'sop', name: 'k-plan' };
  assert.equal(trig.liveRow(withInv({ identified: ['k-plan'] }), sop).hit, true);
  assert.equal(trig.liveRow(result({ skillsLoaded: [{ name: 'sop-k-plan', via: 'skill-tool', count: 1 }] }), sop).hit, true);
  assert.equal(trig.liveRow(withInv({ identified: ['k-verify'] }), sop).hit, false);
});

test('results that never ran or that lack a trigger query are left out of the rows and counted', () => {
  const rows = trig.liveRows([result(), result({ status: 'budget_skipped', capInvocation: null }), { status: 'success', triggerQuery: null }, result({ infraError: 'setup failed', capInvocation: null })], CAP);
  assert.equal(rows.rows.length, 1);
  assert.deepEqual(rows.dropped, { notRun: 1, noQuery: 1, infra: 1 });
});

test('first decisions are tallied so find_skills first, get_skill first and delegating first can be told apart', () => {
  const tally = trig.firstDecisions([withInv({ firstDecision: { kind: 'get_skill', name: 'alpha' } }), withInv({ firstDecision: { kind: 'find_skills', name: 'x' } }), withInv({ firstDecision: { kind: 'find_skills', name: 'y' } }), result()]);
  assert.deepEqual(tally, { get_skill: 1, find_skills: 2, none: 1 });
});

// ---- cross-check ----

test('the cross-check sample keeps both polarities and near misses and is the same for the same seed', () => {
  const qs = [];
  for (let i = 0; i < 10; i++) qs.push(Q(`l${i}`, 'load', 'train'));
  for (let i = 0; i < 6; i++) qs.push(Q(`m${i}`, 'none', 'train', { nearMissOf: 'skill:delta' }));
  for (let i = 0; i < 4; i++) qs.push(Q(`n${i}`, 'none', 'train'));
  const a = trig.crossCheckSample(qs, 0.25, 7);
  assert.equal(a.length, 5);
  assert.ok(a.some((q) => q.expect === 'load') && a.some((q) => q.nearMissOf) && a.some((q) => q.expect === 'none' && !q.nearMissOf));
  assert.deepEqual(trig.crossCheckSample(qs, 0.25, 7).map((q) => q.id), a.map((q) => q.id));
  assert.notDeepEqual(trig.crossCheckSample(qs, 0.25, 8).map((q) => q.id), a.map((q) => q.id));
  assert.equal(trig.crossCheckSample(qs, 0, 7).length, 0);
  assert.equal(trig.crossCheckSample(qs, 1, 7).length, 20);
  assert.throws(() => trig.crossCheckSample(qs, 1.5, 7), /--crosscheck must be between 0 and 1/);
});

test('pairs match proxy and live predictions by query id and ignore queries seen in only one of them', () => {
  const proxy = scoreTrigger([{ queryId: 'a', expect: 'load', hit: true }, { queryId: 'b', expect: 'none', hit: false }, { queryId: 'c', expect: 'load', hit: true }]);
  const live = scoreTrigger([{ queryId: 'a', expect: 'load', hit: true }, { queryId: 'b', expect: 'none', hit: true }, { queryId: 'z', expect: 'load', hit: true }]);
  assert.deepEqual(trig.crossPairs(proxy, live), [{ queryId: 'a', proxy: true, live: true }, { queryId: 'b', proxy: false, live: true }]);
});

// ---- report ----

test('the report names the harness and mode, the counts with intervals, the failure causes and the proxy trust label', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ queryId: `l${i}`, expect: 'load', rep: 1, hit: i < 3, fired: [], failure: i < 3 ? null : 'retrieval' });
  for (let i = 0; i < 4; i++) rows.push({ queryId: `n${i}`, expect: 'none', rep: 1, hit: i === 0, fired: i === 0 ? [] : ['frontend-review'].slice(0, 0), failure: i === 0 ? 'false-trigger' : null });
  const score = scoreTrigger(rows);
  const rep = trig.renderTriggerReport({ cap: CAP, harness: 'kiro-cli', mode: 'proxy', split: 'train', reps: 1, score, proxy: { retrievalFailures: 1, judgmentFailures: 0, noSearch: 0, falseTriggers: 1, errors: 0 }, credits: 1.25, calls: 12, label: 'proxy not validated (n=0, need at least 12)', model: 'claude-sonnet-5.5', surface: 'agent spec at the base ref' });
  assert.match(rep, /^# Trigger test: skill:alpha/);
  assert.match(rep, /harness: kiro-cli; mode: proxy; split: train; reps: 1/);
  assert.match(rep, /precision 0\.75 \(Wilson 95% [0-9.]+ to [0-9.]+, n=4\)/);
  assert.match(rep, /recall 0\.75/);
  assert.match(rep, /retrieval failures \(the candidate list lacked the capability\): 1/);
  assert.match(rep, /judgment failures.*: 0/);
  assert.match(rep, /proxy not validated/);
  assert.match(rep, /1\.25 credits over 12 model calls/);
  assert.match(rep, /intervals are wide at this size/);
});

test('the live report shows the first-decision tally and says early-stopped runs have no metered credits', () => {
  const score = scoreTrigger([{ queryId: 'a', expect: 'load', hit: true }]);
  const rep = trig.renderTriggerReport({ cap: CAP, harness: 'kiro-cli', mode: 'live', split: 'all', reps: 1, score, credits: 2.5, censored: 3, firstDecisions: { find_skills: 2, get_skill: 1 }, model: 'm' });
  assert.match(rep, /first decisions: find_skills 2, get_skill 1/);
  assert.match(rep, /3 early-stopped run\(s\) report no metered credits/);
  assert.doesNotMatch(rep, /proxy not validated/);
});

// ---- the command ----

test('cap trigger refuses a capability the proxy cannot model, a missing capability and missing queries', () => {
  const root = scratch();
  try {
    const r = makeCapRepo(root, { tag: 'v1.2.0' });
    const bench = makeCapBench(root);
    writeEntry(bench, entry());
    const env = { PATH: process.env.PATH, HOME: path.join(root, 'h') };
    fs.mkdirSync(env.HOME);
    const run = (...a) => spawnSync(process.execPath, [BENCH_JS, 'cap', 'trigger', '--repo-root', r.repo, '--bench-dir', bench, '--base', 'v1.2.0', '--model-cmd', 'node -e 0', ...a], { encoding: 'utf8', env });
    assert.match(run('--mode', 'proxy').stderr, /--cap is required/);
    assert.match(run('--cap', 'skill:alpha').stderr, /--mode takes proxy or live/);
    assert.match(run('--cap', 'skill:alpha', '--mode', 'proxy').stderr, /has no trigger queries/);
    assert.match(run('--cap', 'sop:k-plan', '--mode', 'proxy', '--queries', path.join(root, 'none.json')).stderr, /cannot read the drafts file|live mode/);
    assert.match(run('--cap', 'agent:konductor', '--mode', 'proxy', '--queries', path.join(root, 'none.json')).stderr, /needs live mode/);
    assert.equal(run('--cap', 'skill:alpha', '--mode', 'proxy').status, 2);
    assert.match(run('--cap', 'skill:alpha', '--mode', 'live', '--queries', path.join(root, 'none.json')).stderr, /cannot read the drafts file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a proxy run over a draft with a command model writes the report files and scores the replies', () => {
  const root = scratch();
  try {
    const r = makeCapRepo(root, { tag: 'v1.2.0' });
    const bench = makeCapBench(root);
    const env = { PATH: process.env.PATH, HOME: path.join(root, 'h') };
    fs.mkdirSync(env.HOME);
    const draft = path.join(root, 'draft.json');
    write(draft, JSON.stringify({ capId: 'skill:alpha', queries: [
      { id: 'd01', text: 'Please look over this service for input handling problems', expect: 'load', rationale: 'r' },
      { id: 'd02', text: 'Write me a limerick about pandas', expect: 'none', rationale: 'r' },
    ] }));
    const model = path.join(root, 'model.js');
    write(model, `let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const q=/limerick/.test(t);process.stdout.write(t.includes('find_skills returned')?JSON.stringify({get_skill:q?[]:['alpha']}):JSON.stringify({searches:q?[]:[{keyword:'input handling'}]}));});\n`);
    const out = path.join(root, 'out');
    const res = spawnSync(process.execPath, [BENCH_JS, 'cap', 'trigger', '--cap', 'skill:alpha', '--mode', 'proxy', '--queries', draft, '--model-cmd', `node ${model}`, '--out', out, '--repo-root', r.repo, '--bench-dir', bench, '--base', 'v1.2.0', '--concurrency', '1', '--reps', '1'], { encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /precision 1\.00/);
    assert.match(res.stdout, /recall 1\.00/);
    const j = JSON.parse(fs.readFileSync(path.join(out, 'trigger-skill-alpha-kiro-cli-proxy.json'), 'utf8'));
    assert.equal(j.harness, 'kiro-cli');
    assert.equal(j.mode, 'proxy');
    assert.equal(j.rows.length, 2);
    assert.ok(fs.existsSync(path.join(out, 'trigger-skill-alpha-kiro-cli-proxy.md')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
