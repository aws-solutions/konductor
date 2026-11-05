// SPDX-License-Identifier: Apache-2.0
'use strict';

// Refused load_resource(skill::*) calls, the SOP activation form and the failed-call split by tool, read from events
// sliced out of two saved engine v3 streams (paths redacted to <work>, long texts elided, ids renumbered).
//   v3-load-resource-refused: the model asks load_resource for a skill, is refused, hits a get_skill call made before
//     the tool was loaded, loads the tool, then loads the skill.
//   v3-sop-activation: "Load skill: sop-<name>" with toolId disclose_context, then a bare deferred get_skill that fails.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, skillActivationOf, toolNameOf } = require('../lib/stream.js');
const { extractSkills, resultFields, targetOutcome, catalogFrom, SKILL_FIELDS } = require('../lib/skills.js');
const { validateResult } = require('../lib/result.js');

const FX = path.join(__dirname, 'fixtures');
const eventsOf = (name) => parseStream(fs.readFileSync(path.join(FX, name), 'utf8')).events;
const REFUSED = () => eventsOf('v3-load-resource-refused.stream.jsonl');
const ACTIVATION = () => eventsOf('v3-sop-activation.stream.jsonl');
const ZERO = { get_skill: 0, load_resource: 0, find_skills: 0 };
const total = (x) => Object.values(x.failedByTool).reduce((a, b) => a + b, 0);

const inSession = (events, sessionId, subtask) => events.map((e) => ({
  ...e,
  data: { ...e.data, sessionId, update: { ...e.data.update, toolCallId: `${sessionId}-${e.data.update.toolCallId}`, _meta: { ...e.data.update._meta, kiro: { ...e.data.update._meta?.kiro, agentSubtaskId: subtask } } } },
}));

test('real stream: a refused load_resource is one failed load_resource call, the later get_skill is the load', () => {
  const x = extractSkills(REFUSED(), 'kiro-cli');
  assert.deepEqual(x.skillsLoaded.map((s) => `${s.name}:${s.via}:${s.count}`), ['design-doc-guidelines:get_skill:1']);
  assert.equal(x.skillCallsFailed, 2, 'the refused load_resource and the get_skill made before the tool was loaded');
  assert.deepEqual(x.failedByTool, { get_skill: 1, load_resource: 1, find_skills: 0 });
  assert.deepEqual(x.failedCalls, [{ tool: 'load_resource', name: 'design-doc-guidelines' }, { tool: 'get_skill', name: 'design-doc-guidelines' }]);
  assert.deepEqual(x.requested, ['design-doc-guidelines']);
  assert.equal(total(x), x.skillCallsFailed);
});

test('a refused load_resource is the first decision, as a refused get_skill is; the schema loader that follows is not', () => {
  const [call, refusal] = REFUSED();
  const x = extractSkills([call, refusal], 'kiro-cli');
  assert.deepEqual(x.firstDecision, { kind: 'get_skill', name: 'design-doc-guidelines' });
  assert.equal(extractSkills([call], 'kiro-cli').firstDecision.kind, 'none', 'a load_resource call that was never refused is not a decision');
  assert.equal(extractSkills(REFUSED().slice(4, 6), 'kiro-cli').firstDecision.kind, 'none', 'Tool Load alone');
});

test('a refused load_resource sets targetAttempted and leaves targetLoaded false', () => {
  const x = extractSkills(REFUSED().slice(0, 2), 'kiro-cli');
  const catalog = catalogFrom({ skills: ['design-doc-guidelines'], sops: [] });
  const t = targetOutcome({ extraction: x, task: { target: 'design-doc-guidelines', class: 'design' }, arm: { vanilla: false }, catalog });
  assert.equal(t.targetAttempted, true);
  assert.equal(t.targetLoaded, false);
  assert.equal(resultFields({ extraction: x, info: { catalog, startup: null }, task: { target: 'design-doc-guidelines', class: 'design' }, arm: { vanilla: false } }).skillCallsFailedByTool.load_resource, 1);
});

test('real stream: an SOP activation is a load via disclose_context, counted in sopsLoaded and targetLoaded', () => {
  const x = extractSkills(ACTIVATION(), 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, [{ name: 'sop-k-design-doc-creation', via: 'disclose_context', count: 1 }]);
  assert.equal(x.skillBytesLoaded, 10622);
  assert.deepEqual(x.requested, ['sop-k-design-doc-creation']);
  assert.deepEqual(x.firstDecision, { kind: 'skill', name: 'sop-k-design-doc-creation' });
  const catalog = catalogFrom({ sops: ['k-design-doc-creation'], skills: [] });
  const task = { target: 'k-design-doc-creation', class: 'sop' };
  const f = resultFields({ extraction: x, info: { catalog, startup: null }, task, arm: { vanilla: false } });
  assert.deepEqual(f.sopsLoaded.map((s) => s.name), ['sop-k-design-doc-creation']);
  assert.equal(f.targetLoaded, true);
  assert.equal(f.targetAttempted, true);
});

test('negative: a successful Load skill call is not a failed call, and the only failure is the bare deferred get_skill', () => {
  const x = extractSkills(ACTIVATION(), 'kiro-cli');
  assert.equal(x.skillCallsFailed, 1);
  assert.deepEqual(x.failedByTool, { get_skill: 1, load_resource: 0, find_skills: 0 });
  assert.deepEqual(x.failedCalls, [{ tool: 'get_skill', name: '(args not recorded)' }]);
  const alone = extractSkills(ACTIVATION().slice(0, 3), 'kiro-cli');
  assert.equal(alone.skillCallsFailed, 0);
  assert.deepEqual(alone.failedByTool, ZERO);
  assert.deepEqual(alone.failedCalls, []);
});

test('a denied or empty SOP activation is a failed load_resource call, not a load', () => {
  const [call, progress, done] = ACTIVATION();
  const denied = { ...done, data: { ...done.data, update: { ...done.data.update, status: 'failed', rawOutput: { message: 'denied' } } } };
  const x = extractSkills([call, progress, denied], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.deepEqual(x.failedByTool, { get_skill: 0, load_resource: 1, find_skills: 0 });
  assert.deepEqual(x.requested, ['sop-k-design-doc-creation']);
  const empty = { ...done, data: { ...done.data, update: { ...done.data.update, rawOutput: { contentLength: 0 } } } };
  assert.deepEqual(extractSkills([call, progress, empty], 'kiro-cli').skillsLoaded, []);
});

test('skillActivationOf takes only the disclose_context form for an sop- name and leaves toolNameOf alone', () => {
  const kiro = { toolId: 'disclose_context' };
  assert.deepEqual(skillActivationOf({ title: 'Load skill: sop-k-plan', _meta: { kiro } }), { name: 'sop-k-plan' });
  assert.deepEqual(skillActivationOf({ title: 'Loaded skill: sop-k-plan', _meta: { kiro } }), { name: 'sop-k-plan' });
  assert.deepEqual(skillActivationOf({ rawInput: { id: 'skill::sop-k-plan' }, _meta: { kiro } }), { name: 'sop-k-plan' });
  for (const u of [
    { title: 'Load skill: backend-review', _meta: { kiro } },
    { title: 'Load skill: sop-k-plan', _meta: { kiro: {} } },
    { title: 'Load skill: sop-k-plan' },
    { title: 'Load skill: sop-k-plan', _meta: { kiro: { ...kiro, toolName: 'x' } } },
    { rawInput: { id: 'skill::sop-k-plan::x' }, _meta: { kiro } },
    null, undefined,
  ]) assert.equal(skillActivationOf(u), null, JSON.stringify(u));
  assert.equal(toolNameOf({ title: 'Load skill: sop-k-plan', _meta: { kiro } }), null, 'tool counts of existing runs do not move');
});

test('a subagent session is counted: its refused load_resource and its SOP activation join the run totals', () => {
  const events = [...inSession(REFUSED(), 'sess_sub_a', 'sub-1'), ...inSession(ACTIVATION(), 'sess_sub_b', 'sub-2')];
  const x = extractSkills(events, 'kiro-cli');
  assert.equal(x.skillCallsFailed, 3);
  assert.deepEqual(x.failedByTool, { get_skill: 2, load_resource: 1, find_skills: 0 });
  assert.deepEqual(x.skillsLoaded.map((s) => s.name).sort(), ['design-doc-guidelines', 'sop-k-design-doc-creation']);
  assert.equal(resultFields({ extraction: x, info: null, task: null, arm: { vanilla: false } }).skillsScope, 'all-sessions');
});

test('failedByTool adds up to skillCallsFailed, and a failed find_skills and an opencode skill call land under their tools', () => {
  const find = (id, status) => [
    { type: 'sessionUpdate', data: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: id, title: '@konductor-skills/find_skills', rawInput: { tool_id: 'tool::konductor-skills::find_skills', arguments: { query: 'q' } } } } },
    { type: 'sessionUpdate', data: { sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput: { message: 'x' } } } },
  ];
  const x = extractSkills([...find('f1', 'failed'), ...REFUSED()], 'kiro-cli');
  assert.deepEqual(x.failedByTool, { get_skill: 1, load_resource: 1, find_skills: 1 });
  assert.equal(total(x), x.skillCallsFailed);
  const oc = extractSkills([{ type: 'tool_use', part: { tool: 'skill', callID: 'a', state: { input: { name: 'x' }, output: 'boom', status: 'error' } } }], 'opencode');
  assert.deepEqual(oc.failedByTool, { get_skill: 1, load_resource: 0, find_skills: 0 });
  assert.equal(total(oc), oc.skillCallsFailed);
});

test('result fields: skillCallsFailedByTool follows skillCallsFailed, is null with no extraction, and the schema accepts it', () => {
  assert.equal(SKILL_FIELDS.indexOf('skillCallsFailedByTool'), SKILL_FIELDS.indexOf('skillCallsFailed') + 1);
  assert.equal(resultFields({ extraction: null }).skillCallsFailedByTool, null);
  const base = JSON.parse(fs.readFileSync(path.join(FX, 'result-kiro-backfilled.json'), 'utf8'));
  assert.deepEqual(validateResult({ ...base, skillCallsFailedByTool: { get_skill: 0, load_resource: 2, find_skills: 1 } }), []);
  assert.deepEqual(validateResult({ ...base, skillCallsFailedByTool: null }), []);
  assert.notDeepEqual(validateResult({ ...base, skillCallsFailedByTool: { get_skill: 0, load_resource: -1, find_skills: 0 } }), []);
  assert.notDeepEqual(validateResult({ ...base, skillCallsFailedByTool: { get_skill: 0, load_resource: 0, find_skills: 0, skill: 1 } }), []);
  assert.deepEqual(validateResult({ ...base, skillsLoaded: [{ name: 'sop-k-plan', via: 'disclose_context', count: 1 }] }), []);
});
