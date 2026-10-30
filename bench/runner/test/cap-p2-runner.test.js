// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runner options added for capability benchmarking, phase 2: --arm-prefix, --arm-agent, --stop-on, --max-tool-calls,
// and the result fields that record what a run delegated to and found. A fake kiro-cli stands in for the agent.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { parseStream, aggregateStream, mergeAggregates, subagentTargets } = require('../lib/stream.js');
const { extractSkills, firstDecisionOf, identifiedSops, capInvocationOf } = require('../lib/skills.js');
const { applyArmOptions, promptFor, parsePairs } = require('../lib/arm-opts.js');
const { kiroArgs } = require('../lib/harness/kiro.js');
const opencode = require('../lib/harness/opencode.js');
const rc = require('../lib/runconfig.js');
const { makeStopWatcher } = require('../lib/stop-watch.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks, SUITE_NAMES, SUITE_DEFAULTS } = require('../lib/tasks.js');
const { buildResult, validateResult } = require('../lib/result.js');
const { FLAGS, checkArgs } = require('../lib/cli-flags.js');

const FX = path.join(__dirname, 'fixtures');
const eventsOf = (name) => parseStream(fs.readFileSync(path.join(FX, name), 'utf8')).events;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const arm = (over = {}) => ({ id: 'a', label: 'a', ref: null, commitSha: null, vanilla: false, agent: 'konductor', runtime: 'kiro-cli', ...over });

// ---- --arm-prefix / --arm-agent ----

test('parsePairs reads name=value lists and refuses malformed or repeated names', () => {
  assert.deepEqual([...parsePairs('a=/x/f.md,b=/y/g.md', 'arm-prefix')], [['a', '/x/f.md'], ['b', '/y/g.md']]);
  assert.throws(() => parsePairs('a', 'arm-prefix'), /--arm-prefix takes name=VALUE/);
  assert.throws(() => parsePairs('a=', 'arm-prefix'), /--arm-prefix takes name=VALUE/);
  assert.throws(() => parsePairs('a=1,a=2', 'arm-agent'), /--arm-agent names arm "a" twice/);
  assert.throws(() => parsePairs(true, 'arm-agent'), /--arm-agent takes name=VALUE/);
});

test('--arm-prefix reads the file, records sha256 and bytes, and prepends it to the task prompt', () => {
  const root = tmp();
  try {
    const file = path.join(root, 'prefix.md');
    const bytes = Buffer.from('Load the skill first.\n\n');
    fs.writeFileSync(file, bytes);
    const arms = [arm({ id: 'forced' }), arm({ id: 'plain' })];
    const rec = applyArmOptions(arms, { 'arm-prefix': `forced=${file}` });
    assert.deepEqual(arms[0].prefixInfo, { sha256: sha(bytes), bytes: bytes.length });
    assert.equal(arms[1].prefixInfo, undefined);
    assert.deepEqual(rec.armPrefix, { forced: { file, sha256: sha(bytes), bytes: bytes.length } });
    assert.equal(promptFor(arms[0], { prompt: 'Do the work.' }), 'Load the skill first.\n\nDo the work.');
    assert.equal(promptFor(arms[1], { prompt: 'Do the work.' }), 'Do the work.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--arm-prefix refuses a missing, empty or oversized file and an arm that is not in --arms', () => {
  const root = tmp();
  try {
    const arms = () => [arm({ id: 'a' })];
    assert.throws(() => applyArmOptions(arms(), { 'arm-prefix': `a=${path.join(root, 'none')}` }), /cannot read/);
    write(path.join(root, 'empty'), '  \n');
    assert.throws(() => applyArmOptions(arms(), { 'arm-prefix': `a=${path.join(root, 'empty')}` }), /is empty/);
    write(path.join(root, 'big'), 'x'.repeat(90001));
    assert.throws(() => applyArmOptions(arms(), { 'arm-prefix': `a=${path.join(root, 'big')}` }), /over the 90000 byte limit/);
    write(path.join(root, 'ok'), 'p');
    assert.throws(() => applyArmOptions(arms(), { 'arm-prefix': `zz=${path.join(root, 'ok')}` }), /arm "zz" is not among --arms/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--arm-agent sets the entry agent of one arm, the others keep theirs, and vanilla has none to set', () => {
  const arms = [arm({ id: 'direct' }), arm({ id: 'base' })];
  const rec = applyArmOptions(arms, { 'arm-agent': 'direct=k-architect' });
  assert.equal(arms[0].agent, 'k-architect');
  assert.equal(arms[1].agent, 'konductor');
  assert.deepEqual(rec.armAgent, { direct: 'k-architect' });
  assert.throws(() => applyArmOptions([arm({ id: 'vanilla', vanilla: true, agent: null })], { 'arm-agent': 'vanilla=k-architect' }), /vanilla has no agent/);
  assert.throws(() => applyArmOptions([arm()], { 'arm-agent': 'a=bad name' }), /not a valid agent name/);
  assert.deepEqual(applyArmOptions([arm()], {}), { armPrefix: {}, armAgent: {} });
});

test('the kiro command line carries the prefixed prompt and the overridden agent', () => {
  const config = { model: 'm', effort: 'high', agentEngine: 'v2' };
  const a = arm({ prefixText: 'PRE', agent: 'k-architect' });
  const args = kiroArgs({ arm: a, task: { prompt: 'TASK' }, config });
  assert.equal(args.at(-1), 'PRE\n\nTASK');
  assert.equal(args[args.indexOf('--agent') + 1], 'k-architect');
  assert.equal(kiroArgs({ arm: arm(), task: { prompt: 'TASK' }, config }).at(-1), 'TASK');
  const resumed = kiroArgs({ arm: a, task: { prompt: 'TASK' }, config, resume: { sessionId: 's', prompt: 'reply' } });
  assert.equal(resumed.at(-1), 'reply', 'a resumed turn sends the scripted reply, not the prefix again');
});

test('the opencode command line carries the prefixed prompt too', () => {
  const a = arm({ prefixText: 'PRE', runtime: 'opencode' });
  const cmd = opencode.buildCommand({ arm: a, task: { prompt: 'TASK' }, config: { model: 'm', effort: 'high' }, ctx: { opencode: { bin: '/bin/oc' } }, cwd: '/w' });
  assert.equal(cmd.args.at(-1), 'PRE\n\nTASK');
});

test('run-config arm records carry the prefix hash and the agent override', () => {
  const a = arm({ id: 'forced', prefixInfo: { sha256: 'abc', bytes: 3 }, agentOverride: 'k-architect', warnings: [] });
  const [r] = rc.armRecords([a], new Map(), new Map());
  assert.deepEqual(r.armPrefix, { sha256: 'abc', bytes: 3 });
  assert.equal(r.armAgent, 'k-architect');
  const [plain] = rc.armRecords([arm({ warnings: [] })], new Map(), new Map());
  assert.equal(plain.armPrefix, null);
  assert.equal(plain.armAgent, null);
});

// ---- the cap suite, flags ----

test('the cap suite exists and the new run flags are accepted while unknown ones still exit 2', () => {
  assert.ok(SUITE_NAMES.includes('cap'));
  assert.ok(SUITE_DEFAULTS.cap.arms.length >= 1);
  for (const f of ['arm-prefix', 'arm-agent', 'stop-on', 'max-tool-calls']) assert.ok(FLAGS.run.includes(f), f);
  assert.equal(checkArgs('run', { _: [], 'arm-prefix': 'a=b', 'stop-on': 'first-capability', 'max-tool-calls': '4' }), null);
  assert.match(checkArgs('run', { _: [], 'arm-prefx': 'a=b' }), /unknown flag --arm-prefx \(did you mean --arm-prefix\?\)/);
});

// ---- stream and skills extraction from real captured streams ----

test('delegatedTo names the agent of each subagent call in a real delegating stream', () => {
  const agg = aggregateStream(eventsOf('delegating-smoke.stream.jsonl'));
  assert.equal(agg.subagentCalls, 1);
  assert.deepEqual(agg.delegatedTo, { 'k-developer': 1 });
});

test('subagentTargets reads stage roles, a single role and falls back to (unnamed)', () => {
  assert.deepEqual(subagentTargets({ stages: [{ role: 'k-a' }, { role: 'k-b' }, { role: 'k-a' }] }), ['k-a', 'k-b', 'k-a']);
  assert.deepEqual(subagentTargets({ role: 'k-c' }), ['k-c']);
  assert.deepEqual(subagentTargets({ agent_name: 'k-d' }), ['k-d']);
  assert.deepEqual(subagentTargets({ task: 'x' }), ['(unnamed)']);
  assert.deepEqual(subagentTargets(null), ['(unnamed)']);
});

test('delegatedTo takes the input from a later update when the call event had none, and merges across turns', () => {
  const call = { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: 'c1', rawInput: {}, _meta: { kiro: { toolName: 'subagent' } } } } };
  const upd = { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', rawInput: { stages: [{ role: 'k-x' }] } } } };
  const a = aggregateStream([call, upd]);
  assert.deepEqual(a.delegatedTo, { 'k-x': 1 });
  assert.deepEqual(mergeAggregates([a, a]).delegatedTo, { 'k-x': 2 });
});

test('findSkillsBytes counts the bytes find_skills returned, in a real stream', () => {
  const x = extractSkills(eventsOf('kiro-find-skills.stream.jsonl'), 'kiro-cli');
  const upd = eventsOf('kiro-find-skills.stream.jsonl').map((e) => e.data?.update).find((u) => u?.sessionUpdate === 'tool_call_update' && u.rawOutput);
  const expected = upd.rawOutput.items.reduce((n, i) => n + (i.Json?.content ?? []).reduce((m, b) => m + Buffer.byteLength(b.text ?? ''), 0), 0);
  assert.ok(expected > 0);
  assert.equal(x.findSkillsBytes, expected);
  assert.equal(x.skillBytesLoaded, 0, 'find_skills bytes are not skill bytes');
});

const sk = (id, tool, input) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: tool === 'subagent' || tool === 'read' ? undefined : 'konductor-skills' } } } } });

test('firstDecision is the first skills-server or subagent call, in stream order', () => {
  assert.deepEqual(firstDecisionOf([sk('1', 'read', {}), sk('2', 'get_skill', { name: 'alpha' }), sk('3', 'subagent', { role: 'k-a' })], 'kiro-cli'), { kind: 'get_skill', name: 'alpha' });
  assert.deepEqual(firstDecisionOf([sk('1', 'subagent', { stages: [{ role: 'k-a' }] }), sk('2', 'get_skill', { name: 'alpha' })], 'kiro-cli'), { kind: 'subagent', name: 'k-a' });
  assert.deepEqual(firstDecisionOf([sk('1', 'find_skills', { keyword: 'review' })], 'kiro-cli'), { kind: 'find_skills', name: 'review' });
  assert.deepEqual(firstDecisionOf([sk('1', 'read', {})], 'kiro-cli'), { kind: 'none', name: null });
});

test('firstDecision for opencode reads the skill and task tools', () => {
  const ev = (tool, input) => ({ type: 'tool_use', part: { tool, callID: tool, state: { status: 'completed', input, output: 'x' } } });
  assert.deepEqual(firstDecisionOf([ev('read', {}), ev('skill', { name: 'alpha' })], 'opencode'), { kind: 'skill', name: 'alpha' });
  assert.deepEqual(firstDecisionOf([ev('task', { subagent_type: 'k-a' })], 'opencode'), { kind: 'subagent', name: 'k-a' });
});

test('identifiedSops needs the SOP name next to an @ or /sop- invocation in the final text', () => {
  const sops = ['k-plan', 'k-verify'];
  assert.deepEqual(identifiedSops('Use the plan SOP: run `@k-plan` (6 phases).', sops), ['k-plan']);
  assert.deepEqual(identifiedSops('Run /sop-k-verify next.', sops), ['k-verify']);
  assert.deepEqual(identifiedSops('The k-plan approach is fine, no command given.', sops), []);
  assert.deepEqual(identifiedSops(null, sops), []);
});

test('capInvocation joins delegation, find_skills bytes, the first decision and identified SOPs, and is null without a stream', () => {
  const extraction = { findSkillsBytes: 120, requested: ['alpha'], firstDecision: { kind: 'find_skills', name: 'x' } };
  const got = capInvocationOf({ agg: { delegatedTo: { 'k-a': 2, 'k-b': 1 }, finalText: 'try @k-plan' }, extraction, sops: ['k-plan'] });
  assert.deepEqual(got, { delegatedTo: [{ agent: 'k-a', count: 2 }, { agent: 'k-b', count: 1 }], findSkillsBytes: 120, requested: ['alpha'], firstDecision: { kind: 'find_skills', name: 'x' }, identified: ['k-plan'] });
  assert.equal(capInvocationOf({ agg: null, extraction: null }), null);
});

test('buildResult adds capInvocation, triggerQuery, variant and armPrefix, and the result still validates', () => {
  const task = { id: 't', class: 'trigger', target: 'alpha', triggerQuery: { capId: 'skill:alpha', queryId: 'q1', split: 'train', expect: 'load' } };
  const a = arm({ prefixInfo: { sha256: 'a'.repeat(64), bytes: 9 }, variant: { id: 'v', baseRef: 'v1.2.0', baseSha: 'b', tree: 't', variantHash: 'h', ops: [] } });
  const agg = { runFinishedStatus: 'success', credits: 1, meteringEntries: 1, toolCalls: 1, workToolCalls: 1, subagentCalls: 0, toolNames: {}, delegatedTo: {}, finalText: 'ok', sessionIds: [] };
  const r = buildResult({ arm: a, task, replicate: 2, config: { model: 'm', effort: 'high', agentEngine: 'v2' }, exec: { exitCode: 0, timedOut: false, wallClockMs: 5, error: null }, agg, session: null, checks: [], transcript: null, env: null, meta: { flags: [] }, skills: { extraction: { skillsLoaded: [], skillQueries: [], skillBytesLoaded: 0, skillCallsFailed: 0, findSkillsCalls: 0, findSkillsEmpty: 0, requested: [], runtime: 'kiro-cli', findSkillsBytes: 0, firstDecision: { kind: 'none', name: null } }, info: null } });
  assert.deepEqual(r.triggerQuery, { capId: 'skill:alpha', queryId: 'q1', split: 'train', expect: 'load', rep: 2 });
  assert.deepEqual(r.armPrefix, { sha256: 'a'.repeat(64), bytes: 9 });
  assert.equal(r.variant.variantHash, 'h');
  assert.deepEqual(r.capInvocation.firstDecision, { kind: 'none', name: null });
  assert.deepEqual(validateResult(r), []);
  const old = buildResult({ arm: arm(), task: { id: 't', class: 'simple', target: null }, replicate: 1, config: { model: 'm', effort: 'high' }, exec: { exitCode: 0, timedOut: false, wallClockMs: 5 }, agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } });
  assert.equal(old.triggerQuery, null);
  assert.equal(old.variant, null);
  assert.equal(old.armPrefix, null);
  assert.equal(old.capInvocation, null);
});

// ---- the stop watcher ----

const line = (type, data) => `${JSON.stringify({ type, data })}\n`;
const callLine = (id, tool, input, server) => line('sessionUpdate', { update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: input, _meta: { kiro: { toolName: tool, ...(server ? { mcpServerName: server } : {}) } } } });

const doneLine = (id) => line('sessionUpdate', { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { items: [] } } });

function watcher(opts) {
  const root = tmp();
  const file = path.join(root, 'stream.jsonl');
  fs.writeFileSync(file, '');
  const w = makeStopWatcher(file, { runtime: 'kiro-cli', graceMs: 0, ...opts });
  return { w, push: (t) => fs.appendFileSync(file, t), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('first-capability stops on the first skills-server call, a subagent call or the end of the turn, and not on other tools', () => {
  const s = watcher({ stopOn: 'first-capability', graceMs: 60000 });
  try {
    s.push(callLine('1', 'read', { path: 'a' }) + callLine('2', 'shell', {}));
    assert.equal(s.w.poll(), null);
    s.push(callLine('3', 'find_skills', { keyword: 'x' }, 'konductor-skills'));
    assert.equal(s.w.poll(), null, 'a skills call is acted on once its answer is in the stream');
    s.push(doneLine('3'));
    assert.deepEqual(s.w.poll(), { reason: 'first-capability', detail: 'find_skills' });
  } finally { s.done(); }
  const g = watcher({ stopOn: 'first-capability' });
  try { g.push(callLine('1', 'subagent', { stages: [{ role: 'k-a' }] })); assert.deepEqual(g.w.poll(), { reason: 'first-capability', detail: 'subagent' }); } finally { g.done(); }
  const e = watcher({ stopOn: 'first-capability' });
  try { e.push(line('runFinished', { status: 'success' })); assert.deepEqual(e.w.poll(), { reason: 'end_turn', detail: 'runFinished' }); } finally { e.done(); }
});

test('first-load skips find_skills and stops at get_skill', () => {
  const s = watcher({ stopOn: 'first-load' });
  try {
    s.push(callLine('1', 'find_skills', { keyword: 'x' }, 'konductor-skills'));
    assert.equal(s.w.poll(), null);
    s.push(callLine('2', 'get_skill', { name: 'alpha' }, 'konductor-skills') + doneLine('2'));
    assert.deepEqual(s.w.poll(), { reason: 'first-capability', detail: 'get_skill' });
  } finally { s.done(); }
});

test('a skills tool of another server is not a capability call', () => {
  const s = watcher({ stopOn: 'first-capability' });
  try { s.push(callLine('1', 'get_skill', { name: 'a' }, 'other-server')); assert.equal(s.w.poll(), null); } finally { s.done(); }
});

test('max-tool-calls stops independently of any capability call, counting each call id once', () => {
  const s = watcher({ stopOn: 'end_turn', maxToolCalls: 3 });
  try {
    s.push(callLine('1', 'read', {}) + callLine('1', 'read', {}) + callLine('2', 'read', {}));
    assert.equal(s.w.poll(), null, 'two distinct calls');
    s.push(callLine('3', 'read', {}));
    assert.deepEqual(s.w.poll(), { reason: 'max-tool-calls', detail: '3' });
  } finally { s.done(); }
});

test('the watcher waits for the call input before it stops, up to the grace period', () => {
  const root = tmp();
  const file = path.join(root, 's.jsonl');
  fs.writeFileSync(file, callLine('1', 'get_skill', {}, 'konductor-skills'));
  try {
    let now = 1000;
    const w = makeStopWatcher(file, { runtime: 'kiro-cli', stopOn: 'first-capability', graceMs: 500, now: () => now });
    assert.equal(w.poll(), null, 'input not seen yet');
    fs.appendFileSync(file, line('sessionUpdate', { update: { sessionUpdate: 'tool_call_update', toolCallId: '1', rawInput: { name: 'alpha' } } }));
    assert.equal(w.poll(), null, 'the input is in but the answer is not');
    fs.appendFileSync(file, doneLine('1'));
    assert.deepEqual(w.poll(), { reason: 'first-capability', detail: 'get_skill' });
    const w2 = makeStopWatcher(file, { runtime: 'kiro-cli', stopOn: 'first-capability', graceMs: 500, now: () => now });
    fs.writeFileSync(file, callLine('9', 'get_skill', {}, 'konductor-skills'));
    assert.equal(w2.poll(), null);
    now += 600;
    assert.deepEqual(w2.poll(), { reason: 'first-capability', detail: 'get_skill' }, 'the grace period ran out');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the watcher reads opencode tool_use events and the final step', () => {
  const root = tmp();
  const file = path.join(root, 's.jsonl');
  try {
    fs.writeFileSync(file, `${JSON.stringify({ type: 'tool_use', part: { tool: 'read', callID: '1', state: { status: 'completed' } } })}\n`);
    const w = makeStopWatcher(file, { runtime: 'opencode', stopOn: 'first-capability', graceMs: 0 });
    assert.equal(w.poll(), null);
    fs.appendFileSync(file, `${JSON.stringify({ type: 'tool_use', part: { tool: 'skill', callID: '2', state: { status: 'completed', input: { name: 'alpha' } } } })}\n`);
    assert.deepEqual(w.poll(), { reason: 'first-capability', detail: 'skill' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('stop-on and max-tool-calls reject unknown values', () => {
  assert.throws(() => makeStopWatcher('/nope', { runtime: 'kiro-cli', stopOn: 'sometime' }), /--stop-on takes first-capability, first-load or end_turn/);
  assert.throws(() => makeStopWatcher('/nope', { runtime: 'kiro-cli', stopOn: 'end_turn', maxToolCalls: 0 }), /--max-tool-calls must be an integer >= 1/);
});

// ---- the watcher inside a run ----

const ARM = { id: 'konductor', label: 'konductor', ref: null, commitSha: null, harness: 'none', agent: 'konductor', vanilla: true };

function execSetup(cfg, ctxOver = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, ...cfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] }, creditPollMs: 50, ...ctxOver,
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  return { root, ctx, outDir: path.join(root, 'out', 't1'), task: loadTasks(bench).get('t1'), cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
}

const SKILL_CALL = { toolName: 'get_skill', mcpServerName: 'konductor-skills', rawInput: { name: 'alpha' }, rawOutput: { items: [{ Json: { content: [{ type: 'text', text: '{"name":"alpha","content":"# alpha"}' }] } }] } };

test('a run is killed at the first capability call, flagged earlyStopped, censored, and keeps the credits metered so far', async () => {
  const s = execSetup({ credits: 0.7, hangAfterMetering: true, toolCalls: [{ toolName: 'read', rawInput: {} }, SKILL_CALL, { toolName: 'subagent', rawInput: { stages: [{ role: 'k-a' }] } }] }, { stopOn: 'first-capability' });
  try {
    const t0 = Date.now();
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.ok(Date.now() - t0 < 20000, 'killed well before the fake agent would have finished');
    assert.deepEqual(r.flags.filter((f) => f === 'earlyStopped'), ['earlyStopped']);
    assert.equal(r.creditsCensored, true);
    assert.equal(r.credits, 0.7);
    assert.match(r.error, /stopped early: first-capability \(get_skill\)/);
    assert.deepEqual(r.capInvocation.firstDecision, { kind: 'get_skill', name: 'alpha' });
    assert.deepEqual(r.skillsLoaded.map((x) => x.name), ['alpha'], 'the watcher waited for the answer, so the load counts');
    assert.deepEqual(r.capInvocation.requested, ['alpha']);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('max-tool-calls kills a run that never reaches a capability call', async () => {
  const reads = Array.from({ length: 5 }, () => ({ toolName: 'read', rawInput: {} }));
  const s = execSetup({ credits: 0.2, hangAfterMetering: true, toolCalls: reads }, { stopOn: 'first-capability', maxToolCalls: 3 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.ok(r.flags.includes('earlyStopped'));
    assert.match(r.error, /stopped early: max-tool-calls \(3\)/);
    assert.equal(r.creditsCensored, true);
  } finally { s.cleanup(); }
});

test('a run that ends before any capability call is left alone: no flag, not censored', async () => {
  const s = execSetup({ credits: 0.3, toolCalls: [{ toolName: 'read', rawInput: {} }] }, { stopOn: 'first-capability', maxToolCalls: 4 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.flags.includes('earlyStopped'), false);
    assert.equal(r.creditsCensored, false);
  } finally { s.cleanup(); }
});

test('without --stop-on a run that calls a capability runs to the end', async () => {
  const s = execSetup({ credits: 0.3, toolCalls: [SKILL_CALL] });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.flags.includes('earlyStopped'), false);
  } finally { s.cleanup(); }
});

test('the prefixed prompt reaches the agent and the result records the prefix hash', async () => {
  const s = execSetup({ credits: 0.1 });
  try {
    const a = { ...ARM, prefixText: 'LOAD FIRST', prefixInfo: { sha256: 'f'.repeat(64), bytes: 10 } };
    const r = await executeRun({ arm: a, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.deepEqual(r.armPrefix, { sha256: 'f'.repeat(64), bytes: 10 });
    assert.match(fs.readFileSync(path.join(s.outDir, 'command.txt'), 'utf8'), /LOAD FIRST\\n\\nFix the thing\./);
  } finally { s.cleanup(); }
});

test('run takes --auth-db and names the file when it is missing, before anything is built', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    fs.mkdirSync(path.join(root, 'h'));
    const r = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '..', 'bench.js'), 'run', '--suite', 'lite', '--bench-dir', bench, '--arms', 'vanilla', '--auth-db', path.join(root, 'none.sqlite3')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /kiro-cli auth database not found: .*none\.sqlite3/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
