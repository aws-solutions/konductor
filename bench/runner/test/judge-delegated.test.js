// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { buildBundle } = require('../../judge/bundle.js');
const { delegatedBlock } = require('../../judge/delegated.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');
const { DEFAULTS } = require('../../judge/config.js');
const { rubricPrompt } = require('../../judge/prompts.js');
const { packPrompt } = require('../../judge/pack/ask.js');

const upd = (update) => ({ type: 'sessionUpdate', data: { update } });

// A coordinator that runs one command of its own, hands the fix to a child, and reports. The child loads a skill, edits and
// runs the tests. Shapes as kiro-cli writes them: the child's calls carry the hand-off's agentSubtaskId.
const KIRO_DELEGATION = [
  { type: 'runStarted', data: { engine: 'v2' } },
  upd({ sessionUpdate: 'tool_call', toolCallId: 'r1', rawInput: { command: 'ls ROOT_OWN_CALL' }, _meta: { kiro: { toolName: 'execute_bash' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'r1', status: 'completed', rawOutput: 'a.txt b.txt' }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'd1', rawInput: { agent_name: 'k-developer', prompt: 'fix a.txt' }, _meta: { kiro: { toolName: 'subagent', agentSubtaskId: 'S1' } } }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'c0', rawInput: { name: 'backend-development' }, _meta: { kiro: { toolName: 'get_skill', mcpServerName: 'konductor-skills', agentSubtaskId: 'S1' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'c0', status: 'completed', rawOutput: 'SKILL BODY TEXT' }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'c1', rawInput: { path: '/x/r-abc123/work/a.txt' }, _meta: { kiro: { toolName: 'read_file', agentSubtaskId: 'S1' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', rawOutput: 'alpha' }),
  upd({ sessionUpdate: 'tool_call', toolCallId: 'c2', rawInput: { command: 'node --test' }, _meta: { kiro: { toolName: 'execute_bash', agentSubtaskId: 'S1' } } }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'completed', rawOutput: '# tests 9\n# pass 9\n# fail 0' }),
  upd({ sessionUpdate: 'tool_call_update', toolCallId: 'd1', status: 'completed', rawOutput: 'k-developer done' }),
  { type: 'runFinished', data: { status: 'success', finalText: 'The child ran the tests; all pass.' } },
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

test('a Kiro child session\'s tool calls and results reach the judge as helper-session work', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION);
  try {
    const { text, meta } = build();
    assert.match(text, /## Tool calls made by helper sessions the agent started \(2\)\n### Helper session 1 \(2 tool call\(s\)\)/);
    assert.match(text, /- execute_bash: command=node --test \(completed\)\n {4}# tests 9\n {4}# pass 9\n {4}# fail 0/);
    assert.match(text, /- read_file: path=\.\/a\.txt \(completed\)/, 'the scratch workspace path prints relative');
    assert.deepEqual(meta.delegatedCalls, { calls: 2, shown: 2 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the helper-session block names neither the child agent nor its skill loads, and leaves out the main session\'s calls', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION);
  try {
    const { text } = build();
    assert.doesNotMatch(text, /k-developer|developer/);
    assert.doesNotMatch(text, /SKILL BODY TEXT|backend-development|get_skill/);
    assert.doesNotMatch(text, /ROOT_OWN_CALL/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run with no child tool calls has no helper-session block', () => {
  const { root, build } = kiroRun([{ type: 'runFinished', data: { status: 'success', finalText: 'done' } }]);
  try {
    const { text, meta } = build();
    assert.doesNotMatch(text, /helper session/i);
    assert.equal(meta.delegatedCalls, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a Claude Code sub-agent\'s tool calls (parent_tool_use_id) reach the judge', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'cc-coord', harness: 'claude-code' }]);
    const dir = path.join(runDir, 'cc-coord/t1/1');
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'claude-code', 'delegation-dashed-pin.stream.jsonl'), path.join(dir, 'stream.jsonl'));
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    const { text, meta } = buildBundle({ runDir: dir, result, fixtureDir: path.join(bench, 'fixtures/fx'), limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS) });
    assert.match(text, /### Helper session 1 \(1 tool call\(s\)\)\n- Read: file_path=<RUN>\/work\/hello\.py \(completed\)/);
    assert.deepEqual(meta.delegatedCalls, { calls: 1, shown: 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('helper-session work shares the bundle limit: first and last calls are kept and the rest counted', () => {
  const calls = Array.from({ length: 40 }, (_, i) => ({ text: `- execute_bash: command=step ${i} (completed)\n    ${'o'.repeat(80)}` }));
  const block = delegatedBlock([{ session: 1, calls }], 1200);
  assert.ok(block.text.length <= 1200, `block is ${block.text.length} chars`);
  assert.match(block.text, /command=step 0 /);
  assert.match(block.text, /command=step 39 /);
  assert.match(block.text, /- \[\d+ more call\(s\) not shown\]/);
  assert.equal(block.calls, 40);
  assert.ok(block.shown > 0 && block.shown < 40);
});

test('with no room left after the files, the block says the work is not shown', () => {
  const { root, build } = kiroRun(KIRO_DELEGATION, { 'a.txt': 'z'.repeat(500) });
  try {
    const { text, meta } = build({ maxFileChars: 500, maxBundleChars: 500 });
    assert.match(text, /## Tool calls made by helper sessions the agent started \(2\)\n\[not shown: bundle limit reached\]/);
    assert.deepEqual(meta.delegatedCalls, { calls: 2, shown: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the rubric and pack prompts tell the judge to count helper-session work as the agent\'s, so every cached reply is asked again', () => {
  const task = { prompt: 'p', rubric: [{ id: 'c1', weight: 1, criterion: 'x' }] };
  assert.match(rubricPrompt({ task, answerKey: null, bundleText: 'b' }), /Tool calls listed under helper sessions were made by sessions the agent started to do part of the task\. Count that work as the agent's own\./);
  const criteria = [{ id: 'k1', dimension: 'd', weight: 1, question: 'q', levels: { fail: 'f', partial: 'p', pass: 'ok' }, evidence: { quote: 'q', minQuotes: 1 } }];
  assert.match(packPrompt({ task, answerKey: null, bundleText: 'b', changesText: '', criteria }), /Count that work as the agent's own\./);
});
