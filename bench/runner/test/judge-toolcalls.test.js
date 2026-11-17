// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { toolBlock } = require('../../judge/toolcalls.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');
const { rubricPrompt } = require('../../judge/prompts.js');
const { packPrompt } = require('../../judge/pack/ask.js');

const upd = (update) => ({ type: 'sessionUpdate', data: { update } });
const call = (id, toolName, rawInput, rawOutput, extra = {}) => [
  upd({ sessionUpdate: 'tool_call', toolCallId: id, rawInput, _meta: { kiro: { toolName, ...extra } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput }),
];
const S1 = { agentSubtaskId: 'S1' };

// A coordinator that reads its steering and runs one command of its own, hands the fix to a child, and reports. The child
// loads a skill, reads, and runs the tests. Shapes as kiro-cli writes them: the child's calls carry the hand-off's agentSubtaskId.
const KIRO_DELEGATION = [
  { type: 'runStarted', data: { engine: 'v2' } },
  ...call('r0', 'read_file', { path: '/x/r-abc123/work/.kiro/steering/rules.md' }, 'STEERING TEXT'),
  ...call('r1', 'execute_bash', { command: 'ls ROOT_OWN_CALL' }, 'a.txt b.txt'),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'd1', rawInput: { agent_name: 'k-developer', prompt: 'fix a.txt' }, _meta: { kiro: { toolName: 'subagent', agentSubtaskId: 'S1' } } }),
  ...call('c0', 'get_skill', { name: 'backend-development' }, 'SKILL BODY TEXT', { mcpServerName: 'konductor-skills', ...S1 }),
  ...call('c1', 'read_file', { path: '/x/r-abc123/work/a.txt' }, 'alpha', S1),
  ...call('c2', 'execute_bash', { command: 'node --test' }, '# tests 9\n# pass 9\n# fail 0', S1),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'd1', status: 'completed', rawOutput: 'k-developer done' }),
  { type: 'runFinished', data: { status: 'success', finalText: 'The child ran the tests; all pass.' } },
];

// The same work done inline.
const KIRO_INLINE = [
  { type: 'runStarted', data: { engine: 'v2' } },
  ...call('c1', 'read_file', { path: '/x/r-abc123/work/a.txt' }, 'alpha'),
  ...call('c2', 'execute_bash', { command: 'node --test' }, '# tests 9\n# pass 9\n# fail 0'),
  { type: 'runFinished', data: { status: 'success', finalText: 'I ran the tests; all pass.' } },
];

function kiroRun(events, files = { 'a.txt': 'alpha fixed\n' }) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'coord', files }]);
  const dir = path.join(runDir, 'coord/t1/1');
  write(path.join(dir, 'stream.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  const build = (limits = DEFAULTS.limits) => buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });
  return { root, build };
}

test('the main session\'s and the child session\'s tool calls and results reach the judge, each under its own heading', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION);
  try {
    const { text, meta } = build();
    assert.match(text, /## Tool calls the agent made \(3\)\n### Main session, 1 tool call\(s\)\n- execute_bash: command=ls ROOT_OWN_CALL \(completed\)/);
    assert.match(text, /### Helper session 1 \(started by the agent\), 2 tool call\(s\)\n- read_file: path=\.\/a\.txt \(completed\)/);
    assert.match(text, /- execute_bash: command=node --test \(completed\)\n {4}# tests 9\n {4}# pass 9\n {4}# fail 0/);
    assert.deepEqual(meta.toolCalls, { calls: 3, shown: 3 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an inline run gets the same block under the same rules, so neither kind of arm has evidence the other lacks', () => {
  const { root, build } = kiroRun(KIRO_INLINE);
  try {
    const { text, meta } = build();
    assert.match(text, /## Tool calls the agent made \(2\)\n### Main session, 2 tool call\(s\)\n- read_file: path=\.\/a\.txt \(completed\)\n {4}alpha\n- execute_bash: command=node --test \(completed\)/);
    assert.doesNotMatch(text, /Helper session/);
    assert.deepEqual(meta.toolCalls, { calls: 2, shown: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the block names no child agent, no skill load and no read of the arm\'s own tooling', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION);
  try {
    const { text } = build();
    assert.doesNotMatch(text, /k-developer|developer/);
    assert.doesNotMatch(text, /SKILL BODY TEXT|backend-development|get_skill|subagent/);
    assert.doesNotMatch(text, /STEERING TEXT|rules\.md/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reads in the scratch HOME are left out, .kiro/specs reads stay, and other scratch paths print from <scratch>', () => {
  const { root, build } = kiroRun([
    ...call('h1', 'read_file', { path: '/x/r-abc123/home/.kiro/context/routing.md' }, 'ROUTING TEXT'),
    ...call('h2', 'read_file', { path: '/x/r-abc123/work/.kiro/specs/hold/design.md' }, '# design'),
    ...call('h3', 'execute_bash', { command: 'python3 /x/r-abc123/scripts-tmp/patch.py' }, 'patched'),
    { type: 'runFinished', data: { status: 'success', finalText: 'done' } },
  ]);
  try {
    const { text } = build();
    assert.doesNotMatch(text, /ROUTING TEXT|routing\.md/);
    assert.match(text, /- read_file: path=\.\/\.kiro\/specs\/hold\/design\.md \(completed\)/);
    assert.match(text, /- execute_bash: command=python3 <scratch>\/scripts-tmp\/patch\.py \(completed\)/);
    assert.doesNotMatch(text, /\/x\/r-abc123/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run with no tool calls has no tool-call block', () => {
  const { root, build } = kiroRun([{ type: 'runFinished', data: { status: 'success', finalText: 'done' } }]);
  try {
    const { text, meta } = build();
    assert.doesNotMatch(text, /## Tool calls/);
    assert.equal(meta.toolCalls, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a Claude Code run\'s calls (main and parent_tool_use_id) reach the judge', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'cc-coord', harness: 'claude-code' }]);
    const dir = path.join(runDir, 'cc-coord/t1/1');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'claude-code', 'delegation-dashed-pin.stream.jsonl'), path.join(dir, 'stream.jsonl'));
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const { text, meta } = buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });
    assert.match(text, /### Helper session 1 \(started by the agent\), 1 tool call\(s\)\n- Read: file_path=<RUN>\/work\/hello\.py \(completed\)/);
    assert.ok(meta.toolCalls.calls >= 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the block shares the bundle limit: each session keeps its first and last calls and the rest are counted', () => {
  const many = (label, n) => ({ label, calls: Array.from({ length: n }, (_, i) => ({ text: `- execute_bash: command=${label} step ${i} (completed)\n    ${'o'.repeat(80)}` })) });
  const block = toolBlock([many('main', 40), many('helper', 40)], 2400);
  assert.ok(block.text.length <= 2400, `block is ${block.text.length} chars`);
  for (const s of ['main step 0 ', 'main step 39 ', 'helper step 0 ', 'helper step 39 ']) assert.ok(block.text.includes(`command=${s}`), s);
  assert.equal((block.text.match(/more call\(s\) not shown/g) || []).length, 2);
  assert.equal(block.calls, 80);
  assert.ok(block.shown > 0 && block.shown < 80);
});

test('with no room left after the files, the block says the calls are not shown', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION, { 'a.txt': 'z'.repeat(500) });
  try {
    const { text, meta } = build({ maxFileChars: 500, maxBundleChars: 500 });
    assert.match(text, /## Tool calls the agent made \(3\)\n\[not shown: bundle limit reached\]/);
    assert.deepEqual(meta.toolCalls, { calls: 3, shown: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the rubric and pack prompts tell the judge to count main and helper sessions alike as the agent\'s work', () => {
  const task = { prompt: 'p', rubric: [{ id: 'c1', weight: 1, criterion: 'x' }] };
  const rule = /The tool calls section lists the commands and reads the agent made, in its main session and in any helper session it started to do part of the task\. Count both as the agent's own work\./;
  assert.match(rubricPrompt({ task, answerKey: null, bundleText: 'b' }), rule);
  const criteria = [{ id: 'k1', dimension: 'd', weight: 1, question: 'q', levels: { fail: 'f', partial: 'p', pass: 'ok' }, evidence: { quote: 'q', minQuotes: 1 } }];
  assert.match(packPrompt({ task, answerKey: null, bundleText: 'b', changesText: '', criteria }), rule);
});
