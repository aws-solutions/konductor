// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skills = require('../lib/skills.js');
const cc = require('../../plugins/claude-code/parse.js');
const { validate, loadSchema } = require('../lib/schema.js');

const use = (id, name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { id: `m-${id}`, model: 'x', content: [{ type: 'tool_use', id, name, input }], usage: {} } });
const result = (id, content, parent = null, isError = false) => ({ type: 'user', parent_tool_use_id: parent, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const body = (name, parent = null) => ({ type: 'user', parent_tool_use_id: parent, message: { role: 'user', content: [{ type: 'text', text: `Base directory for this skill: /h/.claude/skills/${name}\n\n# ${name}\nbody` }] } });

function configDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-preload-'));
  fs.mkdirSync(path.join(dir, 'agents'));
  const skill = (n, size) => { fs.mkdirSync(path.join(dir, 'skills', n), { recursive: true }); fs.writeFileSync(path.join(dir, 'skills', n, 'SKILL.md'), 'x'.repeat(size)); };
  skill('alpha', 100);
  skill('beta', 50);
  fs.writeFileSync(path.join(dir, 'agents', 'k-dev.md'), '---\nname: k-dev\nskills:\n- alpha\n- beta\n- alpha\ntools:\n- Read\n---\nprompt\n');
  fs.writeFileSync(path.join(dir, 'agents', 'konductor.md'), '---\nname: konductor\nskills:\n- alpha\n---\nprompt\n');
  return dir;
}

test('startupClaude reads each agent\'s frontmatter skills with their sizes, deduplicated', () => {
  const dir = configDir();
  try {
    const s = skills.startupClaude(dir);
    assert.deepEqual(s.preloads['k-dev'], [{ name: 'alpha', bytes: 100 }, { name: 'beta', bytes: 50 }]);
    assert.equal(s.mainThreadPreload, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preloads count the frontmatter skills of each spawned sub-agent, once per spawn; the main thread preloads none', () => {
  const dir = configDir();
  try {
    const startup = skills.startupClaude(dir);
    const events = [use('a1', 'Agent', { subagent_type: 'k-dev', prompt: 'p' }), result('a1', 'done'), use('a2', 'Agent', { subagent_type: 'k-dev', prompt: 'p' }), result('a2', 'done')];
    const x = skills.claudeSkillExtras(events, startup);
    assert.deepEqual(x.skillsPreloaded, [{ name: 'alpha', agents: ['k-dev'], spawns: 2, bytes: 100 }, { name: 'beta', agents: ['k-dev'], spawns: 2, bytes: 50 }]);
    assert.equal(x.skillBytesPreloaded, 300);
    assert.deepEqual(skills.claudeSkillExtras([], startup).skillsPreloaded, []);
    assert.equal(skills.claudeSkillExtras(events, null).skillsPreloaded, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Skill call answered only with "Launching skill" is a load without a body; scope follows parent_tool_use_id', () => {
  const events = [
    use('s1', 'Skill', { skill: 'alpha' }), result('s1', 'Launching skill: alpha'), body('alpha'),
    use('s2', 'Skill', { skill: 'beta' }, 'a1'), result('s2', 'Launching skill: beta', 'a1'),
  ];
  const x = skills.claudeSkillExtras(events, null);
  assert.deepEqual(x.skillLoadsByScope, { main: 1, child: 1 });
  assert.equal(x.skillLoadsNoBody, 1);
  const calls = cc.skillCalls(events);
  assert.deepEqual(calls.map((c) => [c.input.name, c.scope, c.bodySeen]), [['alpha', 'main', true], ['beta', 'child', false]]);
});

test('parallel sub-agents keep their own skill bodies', () => {
  const events = [
    use('s1', 'Skill', { skill: 'alpha' }, 'a1'), use('s2', 'Skill', { skill: 'beta' }, 'a2'),
    result('s1', 'Launching skill: alpha', 'a1'), result('s2', 'Launching skill: beta', 'a2'),
    body('beta', 'a2'), body('alpha', 'a1'),
  ];
  const calls = cc.skillCalls(events);
  assert.match(calls[0].text, /# alpha/);
  assert.match(calls[1].text, /# beta/);
});

test('a shell read of a SKILL.md is a load; a references/ read is counted apart and is not a load', () => {
  const events = [
    use('b1', 'Bash', { command: 'cat /h/.claude/skills/backend-review/SKILL.md' }), result('b1', '# Backend review'),
    use('r1', 'Read', { file_path: '/h/.claude/skills/backend-review/references/checklist.md' }), result('r1', 'list'),
  ];
  const ex = skills.extractSkills(events, 'claude-code');
  assert.deepEqual(ex.skillsLoaded.map((s) => [s.name, s.via]), [['backend-review', 'shell-read-skill-md']]);
  assert.equal(skills.claudeSkillExtras(events, null).skillReferenceReads, 1);
});

test('kiro: a read_file of a SKILL.md, in a sub-agent session, is a load via read-skill-md; a failed read is not a failed skill call', () => {
  const ev = (u) => ({ type: 'sessionUpdate', data: { update: u } });
  const meta = { kiro: { agentSubtaskId: 'sub-1', toolOrigin: 'default' } };
  const events = [
    ev({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read File', kind: 'read', rawInput: { path: '/h/.konductor/skills/backend-review/SKILL.md' }, _meta: meta }),
    ev({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', title: 'Read File', content: [{ type: 'content', content: { type: 'text', text: '# Backend review' } }], _meta: meta }),
    ev({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'Read File', kind: 'read', rawInput: { path: '/h/.konductor/skills/missing/SKILL.md' } }),
    ev({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'failed', title: 'Read File' }),
  ];
  const ex = skills.extractSkills(events, 'kiro-cli');
  assert.deepEqual(ex.skillsLoaded.map((s) => [s.name, s.via, s.count]), [['backend-review', 'read-skill-md', 1]]);
  assert.equal(ex.skillCallsFailed, 0);
});

test('the Claude Code fields pass the result schema and stay off kiro-cli results', () => {
  const extraction = skills.extractSkills([use('s1', 'Read', { file_path: '/h/.claude/skills/alpha/SKILL.md' }), result('s1', '# alpha')], 'claude-code');
  const extras = skills.claudeSkillExtras([], { preloads: {} });
  const ccFields = skills.resultFields({ extraction, info: null, task: {}, arm: {}, extras });
  assert.deepEqual(validate(loadSchema('result').properties.skillsLoaded, ccFields.skillsLoaded), []);
  for (const k of skills.CLAUDE_SKILL_FIELDS) assert.deepEqual(validate(loadSchema('result').properties[k], ccFields[k]), [], k);
  const kiroFields = skills.resultFields({ extraction: skills.extractSkills([], 'kiro-cli'), info: null, task: {}, arm: {} });
  for (const k of skills.CLAUDE_SKILL_FIELDS) assert.equal(k in kiroFields, false, k);
});
