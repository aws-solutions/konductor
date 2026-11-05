// SPDX-License-Identifier: Apache-2.0
'use strict';

// Skill-load capture on engine v3 streams: skills.js, stop-watch.js, contamination.js and the shared helpers in stream.js.
// v3 sends no toolName. A skills-server call is titled "@konductor-skills/get_skill", carries its name in
// rawInput.arguments, and answers in rawOutput.response. A call made before the tool was loaded comes back failed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { parseStream, skillsCallOf, skillResourceCallOf, mcpInputOf } = require('../lib/stream.js');
const { ARGS_NOT_RECORDED, extractSkills, targetOutcome, catalogFrom } = require('../lib/skills.js');
const { makeStopWatcher } = require('../lib/stop-watch.js');
const { scanStream } = require('../lib/contamination.js');

const FX = path.join(__dirname, 'fixtures');
const eventsOf = (name) => parseStream(fs.readFileSync(path.join(FX, name), 'utf8')).events;

const TOOL_ID = (tool) => `tool::konductor-skills::${tool}`;
const up = (u, sub) => ({ type: 'sessionUpdate', data: { sessionId: 'sess_1', update: { ...u, _meta: { kiro: { ...(sub ? { agentSubtaskId: sub } : {}), ...(u._meta ?? {}) } } } } });
const serverCall = (id, tool, args, sub) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: `@konductor-skills/${tool}`, rawInput: { tool_id: TOOL_ID(tool), arguments: args }, _meta: { serverName: 'konductor-skills' } }, sub);
const serverDone = (id, tool, args, response, sub) => up({
  sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', title: `@konductor-skills/${tool}`,
  rawInput: { tool_id: TOOL_ID(tool), arguments: args }, rawOutput: { response, imageBase64Urls: [], message: response },
}, sub);
const body = (name) => JSON.stringify({ name, content: `# ${name}\n${'x'.repeat(100)}` });
const wrapperCall = (id, tool, args) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Tool Call', status: 'in_progress', rawInput: { tool_id: TOOL_ID(tool), arguments: args } });
const refused = (id, message, title) => up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'failed', title, rawOutput: { message } });
const bareCall = (id, sub) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'get_skill', status: 'in_progress' }, sub);
const bareRefused = (id, sub) => up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'failed', rawOutput: 'This tool is deferred and cannot be called directly. Load the schema with load_resource({"id":"tool::konductor-skills::get_skill"}), then call tool_call with the same ID.' }, sub);
const toolLoad = (id) => [
  up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Tool Load', status: 'in_progress', rawInput: { id: TOOL_ID('get_skill') } }),
  up({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', title: 'Tool Load', rawInput: { id: TOOL_ID('get_skill') }, rawOutput: { message: '{"loaded":[]}' } }),
];

const loaded = (x) => x.skillsLoaded.map((s) => `${s.name}:${s.via}:${s.count}`);

// ---- stream.js helpers ----

test('skillsCallOf reads a skills-server call from a v2 name and server, and from a v3 title', () => {
  const v2 = { sessionUpdate: 'tool_call', title: 'x', _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'konductor-skills' } } };
  assert.deepEqual(skillsCallOf(v2), { tool: 'get_skill', deferred: false });
  assert.equal(skillsCallOf({ ...v2, _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'other' } } }), null);
  assert.equal(skillsCallOf({ ...v2, _meta: { kiro: { toolName: 'read_file', mcpServerName: 'konductor-skills' } } }), null);

  assert.deepEqual(skillsCallOf({ title: '@konductor-skills/get_skill', _meta: { kiro: { serverName: 'konductor-skills' } } }), { tool: 'get_skill', deferred: false });
  assert.deepEqual(skillsCallOf({ title: '@konductor-skills/find_skills', _meta: { kiro: {} } }), { tool: 'find_skills', deferred: false });
  assert.equal(skillsCallOf({ title: '@other/get_skill', _meta: { kiro: { serverName: 'other' } } }), null, 'another server');
  assert.deepEqual(skillsCallOf({ title: 'Tool Call', rawInput: { tool_id: TOOL_ID('get_skill'), arguments: {} } }), { tool: 'get_skill', deferred: true });
  assert.deepEqual(skillsCallOf({ title: 'get_skill', _meta: { kiro: {} } }), { tool: 'get_skill', deferred: true }, 'a bare title is a call made before the tool was loaded');
});

test('skillsCallOf ignores the tool loader, other tools and look-alike titles', () => {
  for (const u of [
    { title: 'Tool Load', rawInput: { id: TOOL_ID('get_skill') } },
    { title: 'Load Resource', rawInput: { id: 'skill::konductor-skills::get_skill' } },
    { title: 'get_skill_placeholder' },
    { title: 'get_skill_unavailable_placeholder' },
    { title: 'Tool Call', rawInput: { tool_id: 'tool::konductor-skills::list_everything', arguments: {} } },
    { title: 'Tool Call', rawInput: { tool_id: 'tool::other::get_skill', arguments: {} } },
    { title: 'Read File', rawInput: { path: 'get_skill' } },
    {}, null, undefined,
  ]) assert.equal(skillsCallOf(u), null, JSON.stringify(u));
});

test('mcpInputOf unwraps a v3 call and leaves a v2 input as it is', () => {
  assert.deepEqual(mcpInputOf({ tool_id: TOOL_ID('get_skill'), arguments: { name: 'a' } }), { name: 'a' });
  assert.deepEqual(mcpInputOf({ tool_id: TOOL_ID('get_skill') }), {});
  assert.deepEqual(mcpInputOf({ name: 'a' }), { name: 'a' });
  assert.deepEqual(mcpInputOf({ keyword: 'k', arguments: 'a v2 field named arguments' }), { keyword: 'k', arguments: 'a v2 field named arguments' });
  assert.equal(mcpInputOf(null), null);
});

// ---- skills.js ----

test('golden: a real v3 coordinator stream loads its skills, once per answered call', () => {
  const x = extractSkills(eventsOf('v3-skill-loads.stream.jsonl'), 'kiro-cli');
  assert.deepEqual(loaded(x).sort(), ['delegation-protocol:get_skill:1', 'design-doc-guidelines:get_skill:3', 'design-evaluation:get_skill:2']);
  assert.equal(x.skillCallsFailed, 5, 'one wrapped and four bare calls were refused');
  assert.deepEqual(x.requested.sort(), ['delegation-protocol', 'design-doc-guidelines', 'design-evaluation']);
  assert.ok(x.skillBytesLoaded > 0);
  assert.equal(Object.values(x.bytesByName).reduce((a, b) => a + b, 0), x.skillBytesLoaded);
  assert.equal(x.findSkillsCalls, 0);
});

test('v3: a refused call is a failure and loads nothing, with or without a name', () => {
  const x = extractSkills([
    wrapperCall('w1', 'get_skill', { name: 'delegation-protocol' }), refused('w1', 'Tool "tool::konductor-skills::get_skill" has not been loaded yet.', 'Tool Call'),
    bareCall('b1'), bareRefused('b1'),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 2);
  assert.deepEqual(x.requested, ['delegation-protocol'], 'the wrapped call named a skill, so it counts as attempted');
  assert.equal(x.skillBytesLoaded, 0);
});

test('v3: a refused call followed by a retry through the tool loader counts the skill once', () => {
  const args = { name: 'backend-review' };
  const x = extractSkills([
    wrapperCall('w1', 'get_skill', args), refused('w1', 'not loaded', 'Tool Call'),
    ...toolLoad('l1'),
    serverCall('c1', 'get_skill', args), serverDone('c1', 'get_skill', args, body('backend-review')),
  ], 'kiro-cli');
  assert.deepEqual(loaded(x), ['backend-review:get_skill:1']);
  assert.equal(x.skillCallsFailed, 1);
});

test('v3: a named call that failed with a text answer (the deferred message) is not a load', () => {
  const a = { name: 'backend-review' };
  const text = 'This tool is deferred and cannot be called directly.';
  const x = extractSkills([
    serverCall('c1', 'get_skill', a), up({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'failed', rawOutput: text }),
    serverCall('c2', 'get_skill', a), up({ sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'failed', rawOutput: { response: text } }),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 2);
  assert.equal(x.skillBytesLoaded, 0);
});

test('v3: the tool loader, a failed resource load and look-alike titles are not skill calls', () => {
  const x = extractSkills([
    ...toolLoad('l1'),
    up({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Load Resource', rawInput: { id: 'skill::konductor-skills::get_skill' } }), refused('r1', 'Use one exact resource ID', 'Load Resource'),
    up({ sessionUpdate: 'tool_call', toolCallId: 'p1', title: 'get_skill_placeholder' }), refused('p1', 'Tool "get_skill_placeholder" is not available.'),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 0);
  assert.deepEqual(x.requested, []);
});

test('v3: a sub-agent session is read like the root; a call with no answer, an empty answer or another server loads nothing', () => {
  const a = { name: 'design-evaluation' };
  const x = extractSkills([
    serverCall('c1', 'get_skill', a, 'sub-1'), serverDone('c1', 'get_skill', a, body('design-evaluation'), 'sub-1'),
    serverCall('c2', 'get_skill', { name: 'unanswered' }),
    serverCall('c3', 'get_skill', { name: 'empty' }), serverDone('c3', 'get_skill', { name: 'empty' }, ''),
    up({ sessionUpdate: 'tool_call', toolCallId: 'o1', title: '@other/get_skill', rawInput: { tool_id: 'tool::other::get_skill', arguments: { name: 'x' } }, _meta: { serverName: 'other' } }),
  ], 'kiro-cli');
  assert.deepEqual(loaded(x), ['design-evaluation:get_skill:1']);
  assert.equal(x.skillCallsFailed, 2);
  assert.deepEqual(x.requested.sort(), ['design-evaluation', 'empty', 'unanswered']);
});

test('v3: find_skills through the server title records its query and an empty answer', () => {
  const a = { keyword: 'threat modeling' };
  const x = extractSkills([serverCall('f1', 'find_skills', a), serverDone('f1', 'find_skills', a, '[]')], 'kiro-cli');
  assert.equal(x.findSkillsCalls, 1);
  assert.equal(x.findSkillsEmpty, 1);
  assert.deepEqual(x.skillQueries, ['threat modeling']);
  assert.deepEqual(x.firstDecision, { kind: 'find_skills', name: 'threat modeling' });
});

test('v3 firstDecision: the first call decides, a bare call has no name, a sub-agent call is a delegation', () => {
  const ev = eventsOf('v3-skill-loads.stream.jsonl');
  assert.deepEqual(extractSkills(ev, 'kiro-cli').firstDecision, { kind: 'get_skill', name: 'delegation-protocol' });
  assert.deepEqual(extractSkills([bareCall('b1'), bareRefused('b1')], 'kiro-cli').firstDecision, { kind: 'get_skill', name: null });
  const sub = up({ sessionUpdate: 'tool_call', toolCallId: 'invoke_subagent_1', title: 'Sub-agent: k-architect', rawInput: { name: 'k-architect', prompt: 'p' } });
  assert.deepEqual(extractSkills([sub, serverCall('c1', 'get_skill', { name: 'a' })], 'kiro-cli').firstDecision, { kind: 'subagent', name: 'k-architect' });
});

test('v3: targetOutcome sees a loaded skill, an attempted-only skill and a skill never touched', () => {
  const x = extractSkills(eventsOf('v3-skill-loads.stream.jsonl'), 'kiro-cli');
  const cat = catalogFrom({ sops: [], skills: ['delegation-protocol', 'design-evaluation', 'dynamodb-design'], agents: [] });
  const t = (target) => targetOutcome({ extraction: x, task: { target, class: 'design' }, arm: { vanilla: false }, catalog: cat });
  assert.deepEqual(t('delegation-protocol'), { targetLoaded: true, targetAttempted: true, targetReachable: null });
  assert.deepEqual(t('dynamodb-design'), { targetLoaded: false, targetAttempted: false, targetReachable: null });
});

test('v2 is unchanged: skills and contamination output of the v2 fixtures equal a snapshot taken before the v3 change', () => {
  const snap = JSON.parse(fs.readFileSync(path.join(FX, 'v2-skills-snapshot.json'), 'utf8'));
  assert.deepEqual(Object.keys(snap).sort(), ['delegating-smoke.stream.jsonl', 'kiro-find-skills.stream.jsonl', 'kiro-main-orch-input-validation.stream.jsonl', 'v2-skills-mixed.stream.jsonl']);
  for (const [name, want] of Object.entries(snap)) {
    const ev = eventsOf(name);
    // failedCalls was added after the snapshot; every field the snapshot has must still match.
    const { failedCalls, ...skills } = JSON.parse(JSON.stringify(extractSkills(ev, 'kiro-cli')));
    assert.ok(Array.isArray(failedCalls) && failedCalls.length <= skills.skillCallsFailed, name);
    assert.deepEqual(skills, want.skills, name);
    assert.deepEqual(scanStream(ev, null), want.contamination, name);
  }
});

// ---- stop-watch.js ----

function watcher(opts) {
  const root = tmp();
  const file = path.join(root, 'stream.jsonl');
  fs.writeFileSync(file, '');
  const w = makeStopWatcher(file, { runtime: 'kiro-cli', graceMs: 60000, ...opts });
  return { w, push: (...evs) => fs.appendFileSync(file, evs.map((e) => `${JSON.stringify(e)}\n`).join('')), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('v3 stop-on first-load stops at the first answered get_skill, not at a refused call or the tool loader', () => {
  const s = watcher({ stopOn: 'first-load' });
  try {
    const a = { name: 'delegation-protocol' };
    s.push(wrapperCall('w1', 'get_skill', a), refused('w1', 'not loaded', 'Tool Call'), bareCall('b1'), bareRefused('b1'), ...toolLoad('l1'));
    assert.equal(s.w.poll(), null, 'a refused call is not a load');
    s.push(serverCall('c1', 'get_skill', a));
    assert.equal(s.w.poll(), null, 'the answer is not in yet');
    s.push(serverDone('c1', 'get_skill', a, body('delegation-protocol')));
    assert.deepEqual(s.w.poll(), { reason: 'first-capability', detail: 'get_skill' });
  } finally { s.done(); }
});

test('v3 stop-on first-capability stops on find_skills and on a sub-agent call; first-load ignores find_skills', () => {
  const a = { keyword: 'x' };
  const s = watcher({ stopOn: 'first-capability' });
  try {
    s.push(up({ sessionUpdate: 'tool_call', toolCallId: 'r1', title: 'Read File', kind: 'read', rawInput: { path: 'a' } }));
    assert.equal(s.w.poll(), null);
    s.push(serverCall('f1', 'find_skills', a), serverDone('f1', 'find_skills', a, '[]'));
    assert.deepEqual(s.w.poll(), { reason: 'first-capability', detail: 'find_skills' });
  } finally { s.done(); }
  const d = watcher({ stopOn: 'first-capability' });
  try {
    d.push(up({ sessionUpdate: 'tool_call', toolCallId: 'invoke_subagent_1', title: 'Sub-agent: k-architect', rawInput: { name: 'k-architect', prompt: 'p' } }));
    assert.deepEqual(d.w.poll(), { reason: 'first-capability', detail: 'subagent' });
  } finally { d.done(); }
  const f = watcher({ stopOn: 'first-load' });
  try {
    f.push(serverCall('f1', 'find_skills', a), serverDone('f1', 'find_skills', a, '[]'));
    assert.equal(f.w.poll(), null);
  } finally { f.done(); }
});

// ---- contamination.js ----

const ENTRY = { repo: { name: 'o/r', url: 'https://github.com/o/r', packageNames: [] } };

test('v3 contamination: a shell command is scanned by its kind, whatever title the model gave it', () => {
  const run = (command, id) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Fetch the upstream fix', kind: 'execute', rawInput: { command, description: 'Fetch the upstream fix' } });
  const found = scanStream([run('curl -s https://github.com/o/r/pull/1.diff', 'a'), run('npm test', 'b'), run('git clone https://example.com/x', 'c')], ENTRY);
  assert.deepEqual(found.map((f) => f.tool), ['execute_bash', 'execute_bash']);
  assert.match(found[0].text, /^curl /);
  assert.match(found[1].text, /^git clone /);
});

test('v3 contamination: a web tool reached through a server title is scanned, a file read is not', () => {
  const web = up({ sessionUpdate: 'tool_call', toolCallId: 'w', title: '@fetcher/web_fetch', rawInput: { tool_id: 'tool::fetcher::web_fetch', arguments: { url: 'https://github.com/o/r/pull/1' } }, _meta: { serverName: 'fetcher' } });
  const read = up({ sessionUpdate: 'tool_call', toolCallId: 'r', title: 'Read File', kind: 'read', rawInput: { path: 'https://github.com/o/r' } });
  const found = scanStream([web, read], ENTRY);
  assert.deepEqual(found.map((f) => f.tool), ['web_fetch']);
});

// ---- load_resource with a skill:: id, and calls with no recorded arguments ----

const loadResource = (id, resourceId, sub) => up({ sessionUpdate: 'tool_call', toolCallId: id, title: 'Load Resource', status: 'in_progress', rawInput: { id: resourceId } }, sub);
const loadResourceDone = (id, status, message, sub) => up({ sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput: { message } }, sub);

test('skillResourceCallOf reads the skill name from a v3 load_resource call with a skill:: id', () => {
  assert.deepEqual(skillResourceCallOf({ title: 'Load Resource', rawInput: { id: 'skill::delegation-protocol' }, _meta: { kiro: {} } }), { name: 'delegation-protocol' });
  for (const u of [
    { title: 'Load Resource', rawInput: { id: TOOL_ID('get_skill') } },
    { title: 'Load Resource', rawInput: {} },
    { title: 'Tool Load', rawInput: { id: 'skill::delegation-protocol' } },
    { title: 'Load Resource', rawInput: { id: 'skill::konductor-skills::get_skill' } },
    { title: 'Load Resource', rawInput: { id: 'skill::delegation-protocol' }, _meta: { kiro: { toolName: 'load_resource' } } },
    {}, null, undefined,
  ]) assert.equal(skillResourceCallOf(u), null, JSON.stringify(u));
});

test('v3: a refused load_resource(skill::*) call is a failed skill call that names the skill', () => {
  const x = extractSkills([
    loadResource('r1', 'skill::delegation-protocol'),
    loadResourceDone('r1', 'failed', 'Use one exact resource ID from the current load_resource catalogue.'),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 1);
  assert.deepEqual(x.requested, ['delegation-protocol']);
  assert.deepEqual(x.failedCalls, [{ tool: 'load_resource', name: 'delegation-protocol' }]);
});

test('v3: a load_resource(skill::*) call that succeeded (an SOP resource) is neither a load nor a failure', () => {
  const x = extractSkills([
    loadResource('r1', 'skill::sop-k-plan'),
    loadResourceDone('r1', 'completed', '# k-plan\nsteps'),
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 0);
  assert.deepEqual(x.requested, []);
  assert.deepEqual(x.failedCalls, []);
});

test('v3: load_resource for a tool schema is not a skill call', () => {
  const x = extractSkills([loadResource('r1', TOOL_ID('get_skill')), loadResourceDone('r1', 'failed', 'nope')], 'kiro-cli');
  assert.equal(x.skillCallsFailed, 0);
  assert.deepEqual(x.failedCalls, []);
});

test('v3: a refused load_resource attempt then a get_skill load counts one failure and one load', () => {
  const args = { name: 'delegation-protocol' };
  const x = extractSkills([
    loadResource('r1', 'skill::delegation-protocol'), loadResourceDone('r1', 'failed', 'not in catalogue'),
    serverCall('c1', 'get_skill', args), serverDone('c1', 'get_skill', args, body('delegation-protocol')),
  ], 'kiro-cli');
  assert.deepEqual(loaded(x), ['delegation-protocol:get_skill:1']);
  assert.equal(x.skillCallsFailed, 1);
  assert.deepEqual(x.requested, ['delegation-protocol']);
});

test('v3: a bare deferred call with no recorded arguments is listed as args not recorded', () => {
  const x = extractSkills([
    bareCall('b1'), bareRefused('b1'),
    wrapperCall('w1', 'get_skill', { name: 'backend-review' }), refused('w1', 'not loaded', 'Tool Call'),
  ], 'kiro-cli');
  assert.equal(x.skillCallsFailed, 2);
  assert.deepEqual(x.failedCalls, [
    { tool: 'get_skill', name: ARGS_NOT_RECORDED },
    { tool: 'get_skill', name: 'backend-review' },
  ]);
  assert.equal(ARGS_NOT_RECORDED, '(args not recorded)');
});

test('v3: a failed call with arguments but no name is not labelled args not recorded', () => {
  const x = extractSkills([wrapperCall('w1', 'get_skill', { other: 'x' }), refused('w1', 'not loaded', 'Tool Call')], 'kiro-cli');
  assert.deepEqual(x.failedCalls, [{ tool: 'get_skill', name: null }]);
});
