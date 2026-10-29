// SPDX-License-Identifier: Apache-2.0
'use strict';

// Skill-load extraction from captured streams. Pure functions: no network, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { parseStream } = require('../lib/stream.js');
const {
  extractSkills, catalogFromListing, catalogFromAgentJson, isSopName, startupKiro, startupOpencode, builtinStartup,
  targetOutcome, resultFields, SKILL_FIELDS, normalizeUri,
} = require('../lib/skills.js');
const { buildResult, validateResult } = require('../lib/result.js');

const FX = path.join(__dirname, 'fixtures');
const eventsOf = (name) => parseStream(fs.readFileSync(path.join(FX, name), 'utf8')).events;

const call = (id, tool, input, { server = 'konductor-skills', sid = 's1' } = {}) => ({
  type: 'sessionUpdate',
  data: { sessionId: sid, update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: input, _meta: { kiro: { toolName: tool, mcpServerName: server } } } },
});
const done = (id, rawOutput, status = 'completed') => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput } } });
const jsonOut = (value, isError = false) => ({ items: [{ Json: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError } }] });
const skillBody = (name, size = 200) => jsonOut({ name, content: `# ${name}\n${'x'.repeat(size)}`, path: `/s/${name}/SKILL.md`, size_bytes: size });
const textBytes = (rawOutput) => Buffer.byteLength(rawOutput.items[0].Json.content[0].text);

const loaded = (x) => x.skillsLoaded.map((s) => `${s.name}:${s.via}:${s.count}`);

test('golden: a real main-arm orchestration stream with no skills-server call loads nothing', () => {
  const x = extractSkills(eventsOf('kiro-main-orch-input-validation.stream.jsonl'), 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.deepEqual(x.skillQueries, []);
  assert.equal(x.skillBytesLoaded, 0);
  assert.equal(x.skillCallsFailed, 0);
  assert.equal(x.findSkillsCalls, 0);
  assert.equal(x.findSkillsEmpty, 0);
});

test('golden: a real find_skills call records the query and that it returned an empty list', () => {
  const x = extractSkills(eventsOf('kiro-find-skills.stream.jsonl'), 'kiro-cli');
  assert.deepEqual(x.skillQueries, ['threat modeling']);
  assert.equal(x.findSkillsCalls, 1);
  assert.equal(x.findSkillsEmpty, 1);
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 0, 'an empty search result is an answer, not a failure');
});

test('get_skill: name, count, bytes of the returned text; a duplicate load counts twice', () => {
  const out = skillBody('backend-review', 300);
  const x = extractSkills([
    call('a', 'get_skill', { name: 'backend-review' }), done('a', out),
    call('b', 'get_skill', { name: 'backend-review' }, { sid: 's2' }), done('b', out),
    call('c', 'get_skill', { name: 'verification' }), done('c', skillBody('verification', 50)),
  ], 'kiro-cli');
  assert.deepEqual(loaded(x), ['backend-review:get_skill:2', 'verification:get_skill:1']);
  assert.equal(x.skillBytesLoaded, textBytes(out) * 2 + textBytes(skillBody('verification', 50)));
  assert.equal(x.skillCallsFailed, 0);
});

test('get_skill failures: isError, failed status, empty output, no answer and a missing name all count and load nothing', () => {
  const x = extractSkills([
    call('a', 'get_skill', { name: 'nope' }), done('a', jsonOut('skill not found: nope', true)),
    call('b', 'get_skill', { name: 'bad' }), done('b', skillBody('bad'), 'failed'),
    call('c', 'get_skill', { name: 'empty' }), done('c', { items: [{ Text: '' }] }),
    call('d', 'get_skill', { name: 'blank' }), done('d', { items: [{ Json: { content: [], isError: false } }] }),
    call('e', 'get_skill', { name: 'killed' }),
    call('f', 'get_skill', {}), done('f', skillBody('x')),
    call('g', 'get_skill', { name: 'fine' }), done('g', skillBody('fine')),
  ], 'kiro-cli');
  assert.equal(x.skillCallsFailed, 6);
  assert.deepEqual(loaded(x), ['fine:get_skill:1']);
  assert.deepEqual(x.requested.sort(), ['bad', 'blank', 'empty', 'fine', 'killed', 'nope']);
});

test('find_skills: every string argument is a query, __tool_use_purpose is not, an error is a failed call, results are not empty', () => {
  const x = extractSkills([
    call('a', 'find_skills', { keyword: 'review', tag: 'checker', __tool_use_purpose: 'because' }),
    done('a', jsonOut([{ name: 'backend-review' }])),
    call('b', 'find_skills', { name: 'zzz' }), done('b', jsonOut('[]')),
    call('c', 'find_skills', {}), done('c', jsonOut('boom', true)),
  ], 'kiro-cli');
  assert.deepEqual(x.skillQueries, ['review', 'checker', 'zzz']);
  assert.equal(x.findSkillsCalls, 3);
  assert.equal(x.findSkillsEmpty, 1);
  assert.equal(x.skillCallsFailed, 1);
});

test('other servers, non-skill tools and stray updates are ignored; malformed events do not throw', () => {
  const x = extractSkills([
    null, {}, { type: 'sessionUpdate' }, { type: 'sessionUpdate', data: {} },
    call('a', 'get_skill', { name: 'imposter' }, { server: 'someone-else' }), done('a', skillBody('imposter')),
    call('b', 'read', { path: '/x' }, { server: null }),
    done('ghost', skillBody('ghost')),
    { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'konductor-skills' } } } } },
  ], 'kiro-cli');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 1, 'only the id-less, input-less skills call');
  assert.deepEqual(extractSkills(undefined, 'kiro-cli').skillsLoaded, []);
  assert.deepEqual(extractSkills([], 'opencode').skillsLoaded, []);
});

test('opencode: the skill tool is read from tool_use events, de-duplicated by call id, errors and empty output fail', () => {
  const x = extractSkills(eventsOf('opencode-skill.stream.jsonl'), 'opencode');
  assert.deepEqual(loaded(x), ['backend-review:skill-tool:2', 'sop-k-verify:skill-tool:1']);
  assert.equal(x.skillCallsFailed, 2);
  const body = JSON.parse(fs.readFileSync(path.join(FX, 'opencode-skill.stream.jsonl'), 'utf8').split('\n')[1]).part.state.output;
  assert.equal(x.skillBytesLoaded, Buffer.byteLength(body) * 2 + Buffer.byteLength('<skill_content name="sop-k-verify">\n# Skill: sop-k-verify\n</skill_content>'));
  assert.deepEqual(x.skillQueries, []);
});

test('opencode: the real konductor stream (a task call, no skill) loads nothing', () => {
  const x = extractSkills(eventsOf('opencode-konductor.stream.jsonl'), 'opencode');
  assert.deepEqual(x.skillsLoaded, []);
  assert.equal(x.skillCallsFailed, 0);
});

test('SOP names: a listing wins, then the agent-sop filter, then the sop-/k-/kiro- convention', () => {
  const listing = catalogFromListing({ sops: ['k-verify', 'kiro-spec-workflow'], skills: ['backend-review'], agents: ['k-developer', 'konductor'] });
  assert.equal(listing.sopSource, 'listing');
  assert.equal(isSopName('k-verify', listing), true);
  assert.equal(isSopName('sop-k-verify', listing), true, 'opencode names SOP skills sop-<name>');
  assert.equal(isSopName('backend-review', listing), false);
  assert.equal(isSopName('k-developer', listing), false, 'a listing is exact, the k- convention is not applied');

  const fromAgent = catalogFromAgentJson({ mcpServers: { 'konductor-skills': { args: ['--agent-sop-filter', 'k-plan,k-verify', '--skill-name-filter', 'constraints,verification'] } } });
  assert.equal(fromAgent.sopSource, 'agent-filter');
  assert.equal(isSopName('k-plan', fromAgent), true);
  assert.equal(isSopName('verification', fromAgent), false);

  const conv = catalogFromListing({});
  assert.equal(conv.sopSource, 'convention');
  assert.equal(isSopName('sop-anything', conv), true);
  assert.equal(isSopName('k-whatever', conv), true);
  assert.equal(isSopName('kiro-spec-workflow', conv), true);
  assert.equal(isSopName('backend-review', conv), false);
});

test('targetOutcome: loaded, attempted, reachable; agents, null targets and vanilla give null', () => {
  const cat = catalogFromListing({ sops: ['k-verify'], skills: ['backend-review', 'verification'], agents: ['konductor', 'k-architect'] });
  const x = (names, failed = []) => ({ skillsLoaded: names.map((name) => ({ name, via: 'get_skill', count: 1 })), requested: [...names, ...failed] });
  const arm = { vanilla: false };
  const t = (target, cls, ex, a = arm, c = cat, info = {}) => targetOutcome({ extraction: ex, task: { target, class: cls }, arm: a, catalog: c, ...info });

  assert.deepEqual(t('backend-review', 'review', x(['backend-review'])), { targetLoaded: true, targetAttempted: true, targetReachable: null });
  assert.deepEqual(t('backend-review', 'review', x([], ['backend-review'])), { targetLoaded: false, targetAttempted: true, targetReachable: null });
  assert.deepEqual(t('backend-review', 'review', x(['verification'])), { targetLoaded: false, targetAttempted: false, targetReachable: null });
  assert.equal(t('k-verify', 'sop', x(['sop-k-verify'])).targetLoaded, true, 'opencode sop- name matches the SOP target');
  assert.equal(t('k-verify', 'sop', x(['k-verify'])).targetLoaded, true);
  assert.deepEqual(t('konductor', 'orchestration', x(['verification'])), { targetLoaded: null, targetAttempted: null, targetReachable: null });
  assert.equal(t('k-architect', 'design', x([])).targetLoaded, null, 'an agent is not a skill or SOP');
  assert.equal(t(null, 'simple', x([])).targetLoaded, null);
  assert.equal(t('backend-review', 'review', x(['backend-review']), { vanilla: true }).targetLoaded, null);
  assert.equal(t('k-verify', 'sop', x([]), arm, catalogFromListing({})).targetLoaded, false, 'class sop marks the target a SOP when no listing exists');
  assert.equal(t('backend-review', 'review', x([]), arm, catalogFromListing({})).targetLoaded, null, 'unknown kind without a listing');

  const kiroStartup = { runtime: 'kiro-cli', skillFilter: ['constraints', 'verification', 'ws-*'], sopPromptFilter: ['k-verify'] };
  assert.equal(t('backend-review', 'review', x([]), arm, cat, { startup: kiroStartup }).targetReachable, false);
  assert.equal(t('verification', 'review', x([]), arm, cat, { startup: kiroStartup }).targetReachable, true);
  assert.equal(t('k-verify', 'sop', x([]), arm, cat, { startup: kiroStartup }).targetReachable, false, 'kiro serves SOPs as prompts only');
  const ocStartup = { runtime: 'opencode', skillNames: ['backend-review', 'sop-k-verify'] };
  assert.equal(t('backend-review', 'review', x([]), arm, cat, { startup: ocStartup }).targetReachable, true);
  assert.equal(t('k-verify', 'sop', x([]), arm, cat, { startup: ocStartup }).targetReachable, true);
});

test('startupKiro: prompt and resources with sizes, scratch paths normalised, unknown sizes counted, filters kept', () => {
  const agent = JSON.parse(fs.readFileSync(path.join(FX, 'kiro-main-installed-agent.json'), 'utf8'));
  const root = tmp();
  try {
    write(path.join(root, 'context/k-core-rules.md'), 'a'.repeat(100));
    write(path.join(root, 'context/k-orchestrator-routing-rules.md'), 'b'.repeat(40));
    const s = startupKiro(agent, { contextDirs: [path.join(root, 'context')] });
    assert.equal(s.runtime, 'kiro-cli');
    assert.equal(s.builtin, false);
    assert.equal(s.count, 5);
    assert.deepEqual(s.resources.map((r) => r.kind), ['prompt', 'file', 'skill-glob', 'file', 'file']);
    assert.equal(s.resources[0].bytes, Buffer.byteLength(agent.prompt));
    assert.equal(s.resources[1].bytes, null, 'AGENTS.md is resolved against the run cwd');
    assert.equal(s.resources[3].uri, '~/.kiro/context/k-orchestrator-routing-rules.md');
    assert.equal(s.resources[3].bytes, 40);
    assert.equal(s.resources[4].bytes, 100);
    assert.equal(s.totalBytes, Buffer.byteLength(agent.prompt) + 140);
    assert.equal(s.unknownSizes, 2);
    assert.equal(s.skillFilter.length, 13);
    assert.ok(s.skillFilter.includes('verification') && !s.skillFilter.includes('backend-review'));
    assert.ok(s.sopPromptFilter.includes('k-verify'));
    assert.equal(startupKiro(agent).unknownSizes, 4, 'without a context dir the rule files have no size');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('startupKiro reads sizes from the installed file when it exists', () => {
  const root = tmp();
  try {
    write(path.join(root, 'home/.kiro/context/k-core-rules.md'), 'c'.repeat(77));
    const s = startupKiro({ prompt: 'p', resources: [`file://${path.join(root, 'home/.kiro/context/k-core-rules.md')}`] });
    assert.equal(s.resources[1].bytes, 77);
    assert.equal(s.totalBytes, 78);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('startupOpencode: the primary agent file and the skill index (name plus description) with sizes', () => {
  const root = tmp();
  try {
    write(path.join(root, 'agents/konductor.md'), '---\nmode: primary\n---\nBody\n');
    write(path.join(root, 'agents/k-researcher.md'), '---\nmode: subagent\n---\nBody\n');
    write(path.join(root, 'skills/alpha/SKILL.md'), '---\nname: alpha\ndescription: First skill.\nversion: 1\n---\n# Body that is not counted\n');
    write(path.join(root, 'skills/sop-k-plan/SKILL.md'), '---\nname: sop-k-plan\ndescription: Plans.\n---\n');
    const s = startupOpencode(root);
    assert.equal(s.runtime, 'opencode');
    assert.deepEqual(s.resources.map((r) => r.kind), ['agent-prompt', 'skill-index']);
    assert.equal(s.resources[0].bytes, Buffer.byteLength('---\nmode: primary\n---\nBody\n'));
    assert.equal(s.resources[1].count, 2);
    assert.equal(s.resources[1].bytes, Buffer.byteLength('alpha') + Buffer.byteLength('First skill.') + Buffer.byteLength('sop-k-plan') + Buffer.byteLength('Plans.'));
    assert.deepEqual(s.skillNames, ['alpha', 'sop-k-plan']);
    assert.equal(s.count, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('builtinStartup is best effort: no resources, sizes unknown, and it says so', () => {
  for (const rt of ['kiro-cli', 'opencode']) {
    const s = builtinStartup(rt);
    assert.equal(s.builtin, true);
    assert.deepEqual(s.resources, []);
    assert.equal(s.count, null);
    assert.equal(s.totalBytes, null);
    assert.match(s.note, /best effort/);
  }
});

test('normalizeUri shortens scratch install paths and leaves other URIs alone', () => {
  assert.equal(normalizeUri('file:///tmp/w-abc/r-def/home/.kiro/context/x.md'), '~/.kiro/context/x.md');
  assert.equal(normalizeUri('file://AGENTS.md'), 'AGENTS.md');
  assert.equal(normalizeUri('skill://.kiro/skills/ws-*/SKILL.md'), 'skill://.kiro/skills/ws-*/SKILL.md');
});

test('resultFields: every field is present, SOPs are the subset of loaded skills, vanilla and missing data give empty or null', () => {
  const events = [call('a', 'get_skill', { name: 'k-verify' }), done('a', skillBody('k-verify', 10)), call('b', 'get_skill', { name: 'verification' }), done('b', skillBody('verification', 10))];
  const cat = catalogFromListing({ sops: ['k-verify'], skills: ['verification'], agents: [] });
  const startup = { count: 5, totalBytes: 1000 };
  const f = resultFields({ extraction: extractSkills(events, 'kiro-cli'), info: { catalog: cat, startup }, task: { target: 'k-verify', class: 'sop' }, arm: { vanilla: false } });
  assert.deepEqual(Object.keys(f).sort(), [...SKILL_FIELDS].sort());
  assert.deepEqual(f.sopsLoaded.map((s) => s.name), ['k-verify']);
  assert.equal(f.sopNameSource, 'listing');
  assert.equal(f.startupResourceCount, 5);
  assert.equal(f.skillsScope, 'all-sessions');
  assert.equal(f.targetLoaded, true);
  assert.equal(f.findSkillsEmpty, 0);

  const van = resultFields({ extraction: extractSkills([], 'kiro-cli'), info: null, task: { target: 'k-verify', class: 'sop' }, arm: { vanilla: true } });
  assert.deepEqual(van.skillsLoaded, []);
  assert.deepEqual(van.sopsLoaded, []);
  assert.equal(van.targetLoaded, null);
  assert.equal(van.startupResourceCount, null);

  const none = resultFields({ extraction: null, info: null, task: { target: null }, arm: { vanilla: false } });
  assert.deepEqual(Object.keys(none).sort(), [...SKILL_FIELDS].sort());
  assert.ok(Object.values(none).every((v) => v === null));
  assert.equal(resultFields({ extraction: extractSkills([], 'opencode'), info: null, task: {}, arm: {} }).skillsScope, 'parent-session');
});

test('buildResult carries the fields and the schema accepts them, with and without data', () => {
  const base = {
    arm: { id: 'a', label: 'a', ref: 'r', commitSha: 'c', harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false },
    task: { id: 't', target: 'backend-review', class: 'review' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine: 'v2' },
    exec: { timedOut: false, exitCode: 0, wallClockMs: 1 }, agg: { runFinishedStatus: 'success', meteringEntries: 1, credits: 1, toolCalls: 0, workToolCalls: 0, subagentCalls: 0, toolNames: {} }, session: null, checks: [], transcript: null, env: {},
  };
  const events = [call('a', 'get_skill', { name: 'backend-review' }), done('a', skillBody('backend-review'))];
  const withData = buildResult({ ...base, skills: { extraction: extractSkills(events, 'kiro-cli'), info: { catalog: catalogFromListing({ skills: ['backend-review'] }), startup: { count: 3 } } } });
  assert.deepEqual(validateResult(withData), []);
  assert.deepEqual(withData.skillsLoaded, [{ name: 'backend-review', via: 'get_skill', count: 1 }]);
  assert.equal(withData.targetLoaded, true);
  const without = buildResult(base);
  assert.deepEqual(validateResult(without), []);
  for (const k of SKILL_FIELDS) assert.equal(without[k], null, k);
});
