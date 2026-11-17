// SPDX-License-Identifier: Apache-2.0
'use strict';

// --introspect report: sub-agent linking, per-scope skill attribution, Claude Code preloads and first requests, hook
// text found in the request bodies, and the offline regen script. Everything reads fixture files only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const report = require('../lib/introspect/report.js');
const { regen } = require('../../scripts/introspect-regen.js');
const { render } = require('../../scripts/introspect-summary.js');

const jsonl = (xs) => `${xs.map((x) => JSON.stringify(x)).join('\n')}\n`;

// ---- kiro-cli fixture: the root spawns two k-architect children; the first loads one skill and has one refused call ----

let seq = 0;
const kev = (update, kiro = {}) => ({ type: 'sessionUpdate', data: { sessionId: 'sess_1', update: { ...update, _meta: { kiro } } } });
function kcall(events, title, rawInput, output, { kiro = {}, status = 'completed' } = {}) {
  const toolCallId = `tc${++seq}`;
  events.push(kev({ sessionUpdate: 'tool_call', toolCallId, title, rawInput }, kiro));
  if (output !== undefined) events.push(kev({ sessionUpdate: 'tool_call_update', toolCallId, status, rawOutput: typeof output === 'string' ? { message: output } : output }, kiro));
  return toolCallId;
}
// The shape kiro-cli 3.x streams: the skills-server answer is a JSON string under rawOutput.response.
const getSkill = (events, name, kiro = {}) => kcall(events, '@konductor-skills/get_skill', { name }, { response: JSON.stringify({ name, content: `---\nname: ${name}\n---\nbody` }) }, { kiro: { serverName: 'konductor-skills', ...kiro } });
const refused = (events, name, kiro) => kcall(events, 'Tool Call', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name } }, 'This tool is deferred and cannot be called directly.', { kiro, status: 'failed' });
const spawn = (events, target, sub) => kcall(events, `Sub-agent: ${target}`, { name: target, prompt: `brief for ${sub}` }, undefined, { kiro: { kind: 'agent-subtask', agentSubtaskId: sub } });
const spawnDone = (events, id, sub) => events.push(kev({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { message: 'done' } }, { kind: 'agent-subtask', agentSubtaskId: sub }));

function kiroRun(root) {
  const run = path.join(root, 'kiro', 'coord', 't1', '1');
  const e = [{ type: 'runStarted', data: { engine: 'v3' } }];
  getSkill(e, 'delegation-protocol');
  const s1 = spawn(e, 'k-architect', 'sub-A');
  refused(e, 'design-doc-guidelines', { agentSubtaskId: 'sub-A' });
  getSkill(e, 'design-doc-guidelines', { agentSubtaskId: 'sub-A' });
  spawnDone(e, s1, 'sub-A');
  const s2 = spawn(e, 'k-architect', 'sub-B');
  getSkill(e, 'design-evaluation', { agentSubtaskId: 'sub-B' });
  spawnDone(e, s2, 'sub-B');
  e.push({ type: 'runFinished', data: { status: 'success', finalText: 'done' } });
  write(path.join(run, 'stream.jsonl'), jsonl(e));
  write(path.join(run, 'result.json'), JSON.stringify({ armId: 'coord', taskId: 't1', replicate: 1, harness: 'kiro-cli', agent: 'konductor', status: 'success', checks: [], flags: [],
    skillsLoaded: [{ name: 'delegation-protocol', via: 'get_skill', count: 1 }, { name: 'design-doc-guidelines', via: 'get_skill', count: 1 }, { name: 'design-evaluation', via: 'get_skill', count: 1 }] }));
  write(path.join(run, 'session', 'sess_1', 'messages.jsonl'), '{}\n');
  write(path.join(run, 'session', 'sess_1', 'sub-executions', 'sub-A.jsonl'), '{}\n{}\n');
  write(path.join(run, 'session', 'sess_1', 'sub-executions', 'sub-B.jsonl'), '{}\n');
  const dump = (exec, content) => JSON.stringify({ invocation: { agentName: 'k-architect', executionId: exec }, request: { conversationState: { history: [], currentMessage: { userInputMessage: { content, modelId: 'm' } } } } });
  write(path.join(run, 'introspect', 'kiro', 'requests', 'chat-a', '0000-1000.json'), dump('sub-A', 'child A prompt'));
  write(path.join(run, 'introspect', 'kiro', 'requests', 'chat-a', '0001-2000.json'), dump('sub-A', 'child A prompt, turn 2'));
  write(path.join(run, 'introspect', 'probe.json'), JSON.stringify({ harness: 'kiro-cli' }));
  return run;
}

test('kiro-cli: each child is linked to its sub-execution transcript by subtask id, and every skill call carries its scope', () => {
  const root = tmp();
  try {
    const r = report.buildReport(kiroRun(root));
    assert.deepEqual(r.subagents.map((c) => [c.index, c.target, c.key, c.transcript, c.linkedBy]), [
      [1, 'k-architect', 'sub-A', path.join('session', 'sess_1', 'sub-executions', 'sub-A.jsonl'), 'subtask id'],
      [2, 'k-architect', 'sub-B', path.join('session', 'sess_1', 'sub-executions', 'sub-B.jsonl'), 'subtask id'],
    ]);
    assert.equal(r.subagents[0].transcriptLines, 2);
    assert.equal(r.subagents[0].firstRequest.requests, 2);
    assert.equal(r.subagents[1].firstRequest, null);
    assert.deepEqual(r.skills.loads.map((l) => [l.name, l.scope]), [['delegation-protocol', 0], ['design-doc-guidelines', 1], ['design-evaluation', 2]]);
    assert.deepEqual(r.skills.failed.map((f) => [f.scope, f.deferred]), [[1, true]]);
    assert.deepEqual(r.skills.totals, { rootLoads: 1, childLoads: 2, refused: 1, failed: 0, rootRefusedOrFailed: 0, childRefusedOrFailed: 1, referenceReads: 0 });
    assert.deepEqual(r.skills.byScope.map((b) => [b.label, b.loads.length, b.failed.length]), [['root', 1, 0], ['child #1 k-architect', 1, 1], ['child #2 k-architect', 1, 0]]);
    assert.deepEqual(r.sideRequests, []);
    const md = report.renderReport(r);
    assert.match(md, /- child #1: step #\d+ root -> k-architect \(completed\).*sub-executions\/sub-A\.jsonl \(2 lines, linked by subtask id\), subtask sub-A/);
    assert.match(md, /- loads by scope: root 1, children 2 \(total 3\); refused 1, failed 0/);
    assert.match(md, /child #1 k-architect: loaded 1: design-doc-guidelines \(#\d+\); failed or refused 1: #\d+ refused/);
    assert.match(md, /#\d+ \[child #1\] design-doc-guidelines \(refused\)/);
    assert.doesNotMatch(md, /not matched/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- Claude Code fixture: the root spawns one k-developer child that has two frontmatter skills and loads one ----

const attrs = (o) => Object.entries(o).map(([key, v]) => ({ key, value: typeof v === 'number' ? { intValue: String(v) } : { stringValue: String(v) } }));
const logRecord = (name, a, ts) => ({ timeUnixNano: String(BigInt(ts) * 1000000n), body: { stringValue: `claude_code.${name}` }, attributes: attrs({ 'event.name': name, 'event.timestamp': new Date(ts).toISOString(), ...a }) });
const NUDGE = 'Before you start, check the skills available to you.';
const rootBody = { model: 'm', system: [{ type: 'text', text: 'You are the agent.' }], messages: [{ role: 'user', content: 'Fix it.' }, { role: 'system', content: `SessionStart:startup hook success: ${NUDGE}\n\n# Environment\nwork dir\n` }], tools: [{ name: 'Agent' }] };
const preloadMsg = (name) => `<command-message>${name}</command-message>\n<command-name>${name}</command-name>\nBase directory for this skill: /h/.claude/skills/${name}\n\n# ${name}\nbody`;
const childBody = { model: 'm', system: [{ type: 'text', text: 'You are k-developer.' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'TARGET AGENT: k-developer' }, { type: 'text', text: preloadMsg('alpha') }, { type: 'text', text: preloadMsg('beta') }] }], tools: [{ name: 'Read' }] };

function claudeRun(root) {
  const run = path.join(root, 'cc', 'cc-coord', 't1', '1');
  const stream = [
    { type: 'system', subtype: 'init', model: 'm' },
    { type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', hook_name: 'SessionStart:startup', exit_code: 0, outcome: 'success', output: NUDGE },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tuA', name: 'Agent', input: { subagent_type: 'k-developer', prompt: 'TARGET AGENT: k-developer' } }] }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tuS', name: 'Skill', input: { skill: 'beta' } }] }, parent_tool_use_id: 'tuA' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tuS', content: 'Launching skill: beta' }] }, parent_tool_use_id: 'tuA' },
    { type: 'assistant', message: { id: 'm3', content: [{ type: 'tool_use', id: 'tuR', name: 'Read', input: { file_path: '/h/.claude/skills/beta/references/more.md' } }] }, parent_tool_use_id: 'tuA' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tuR', content: 'more' }] }, parent_tool_use_id: 'tuA' },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tuA', content: 'fixed' }] }, parent_tool_use_id: null },
    { type: 'result', subtype: 'success', result: 'Done.' },
  ];
  write(path.join(run, 'stream.jsonl'), jsonl(stream));
  write(path.join(run, 'result.json'), JSON.stringify({ armId: 'cc-coord', taskId: 't1', replicate: 1, harness: 'claude-code', agent: 'konductor', status: 'success', checks: [], flags: [],
    skillsLoaded: [{ name: 'beta', via: 'skill-tool', count: 1 }], skillsPreloaded: [{ name: 'alpha', agents: ['k-developer'], spawns: 1, bytes: 100 }, { name: 'beta', agents: ['k-developer'], spawns: 1, bytes: 50 }] }));
  const t0 = 1_800_000_000_000;
  const records = [
    logRecord('api_request_body', { body: JSON.stringify(rootBody), query_source: 'sdk' }, t0),
    logRecord('api_request', { duration_ms: 100, input_tokens: 2, output_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 500, query_source: 'sdk' }, t0 + 100),
    logRecord('api_request_body', { body: JSON.stringify(childBody), query_source: 'agent:custom:k-developer', agent_id: 'aid1' }, t0 + 200),
    logRecord('api_request', { duration_ms: 100, input_tokens: 3, output_tokens: 10, cache_read_tokens: 40, cache_creation_tokens: 900, query_source: 'agent:custom', agent_id: 'aid1' }, t0 + 300),
  ];
  write(path.join(run, 'introspect', 'otlp.jsonl'), jsonl([{ signal: 'logs', body: { resourceLogs: [{ scopeLogs: [{ logRecords: records }] }] } }]));
  write(path.join(run, 'introspect', 'probe.json'), JSON.stringify({ harness: 'claude-code' }));
  const proj = path.join(run, 'introspect', 'claude-projects', '-w', 'sess');
  // The brief differs from the transcript's first prompt on purpose: the link must come from meta.json's toolUseId.
  write(path.join(proj, 'subagents', 'agent-aid1.jsonl'), jsonl([
    { type: 'user', message: { content: 'a different first line' } },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: preloadMsg('alpha') }] } },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: preloadMsg('beta') }] } },
  ]));
  write(path.join(proj, 'subagents', 'agent-aid1.meta.json'), JSON.stringify({ agentType: 'k-developer', toolUseId: 'tuA' }));
  return run;
}

test('Claude Code: a child is linked by its meta toolUseId and shows its preloads, first-request tokens and skill classification', () => {
  const root = tmp();
  try {
    const r = report.buildReport(claudeRun(root));
    const [c] = r.subagents;
    assert.equal(c.index, 1);
    assert.equal(c.linkedBy, 'tool use id');
    assert.equal(c.agentId, 'aid1');
    assert.deepEqual(c.preloads.expected, [{ name: 'alpha', bytes: 100 }, { name: 'beta', bytes: 50 }]);
    assert.deepEqual(c.preloads.seen.map((x) => x.name), ['alpha', 'beta']);
    assert.equal(c.firstRequest.tokens, 943);
    assert.deepEqual(c.firstRequest.skillBodies, ['alpha', 'beta']);
    assert.deepEqual(c.skillUse, { preloadSource: 'transcript', preloadedOnly: ['alpha'], onDemandOnly: [], both: ['beta'] });
    assert.deepEqual(r.skills.loads.map((l) => [l.name, l.scope]), [['beta', 1]]);
    assert.deepEqual(r.skills.referenceReads.map((x) => x.scope), [1]);
    assert.equal(r.skills.totals.childLoads, 1);
    assert.equal(r.skills.totals.rootLoads, 0);
    const md = report.renderReport(r);
    assert.match(md, /preloaded skills \(frontmatter, from result\.json\): 2, 150 bytes: alpha 100 B, beta 50 B/);
    assert.match(md, /first request \(otel api_request \+ otel api_request_body\): 943 tokens \(input 3, cache read 40, cache write 900\)/);
    assert.match(md, /skills: preloaded only 1 \(alpha\); loaded on demand only 0; both 1 \(beta\)/);
    assert.match(md, /#\d+ \[child #1\] \/h\/\.claude\/skills\/beta\/references\/more\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude Code: hook text in the request bodies is reported with the block it sits in', () => {
  const root = tmp();
  try {
    const r = report.buildReport(claudeRun(root));
    assert.deepEqual(r.first.hookInstructions.map((h) => [h.where, h.kind, h.hook, h.chars, h.matchedStream]), [['messages[1]', 'hook output', 'SessionStart:startup', NUDGE.length, true]]);
    assert.equal(r.hookInjections.length, 1);
    assert.deepEqual([r.hookInjections[0].bodies, r.hookInjections[0].ofBodies, r.hookInjections[0].childBodies, r.hookInjections[0].ofChildBodies], [1, 2, 0, 1]);
    const md = report.renderReport(r);
    assert.match(md, /- hook instructions in the request: SessionStart:startup hook success at messages\[1\], 52 chars "Before you start/);
    assert.match(md, /- injected into the prompt: SessionStart:startup hook success at messages\[1\].*present in 1 of 2 bodies \(1 of 1 root, 0 of 1 sub-agent\)/);
    // A hook text the stream did not record still counts, up to the next blank line.
    assert.deepEqual(report.hookTextsIn([{ where: 'system[0]', text: 'PreToolUse:Bash hook blocking error: no rm\n\nrest' }]).map((h) => [h.where, h.hook, h.outcome, h.head]), [['system[0]', 'PreToolUse:Bash', 'blocking error', 'no rm']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('introspect-regen writes every report and the summary to a new directory and leaves the source untouched', () => {
  const root = tmp();
  try {
    const src = path.join(root, 'src');
    kiroRun(src);
    claudeRun(src);
    const before = fs.readdirSync(src, { recursive: true }).map(String).sort();
    const dest = path.join(root, 'regen');
    assert.equal(regen(src, dest).runs, 2);
    assert.deepEqual(fs.readdirSync(src, { recursive: true }).map(String).sort(), before);
    for (const rel of ['kiro/coord/t1/1', 'cc/cc-coord/t1/1']) for (const f of ['timeline.md', 'timeline.json']) assert.ok(fs.existsSync(path.join(dest, rel, 'introspect', f)));
    const rows = JSON.parse(fs.readFileSync(path.join(dest, 'introspect-summary.json'), 'utf8'));
    const by = Object.fromEntries(rows.map((x) => [x.arm, x]));
    assert.deepEqual([by.coord.rootLoads, by.coord.childLoads, by.coord.refused, by.coord.preloads], [1, 2, 1, null]);
    assert.deepEqual([by['cc-coord'].rootLoads, by['cc-coord'].childLoads, by['cc-coord'].preloads, by['cc-coord'].preloadBytes], [0, 1, 2, 150]);
    const md = render(rows);
    assert.match(md, /## Skill use by scope, per arm/);
    assert.match(md, /\| cc-coord \| 1 \| 0 \| 1 \| 2 \| 150 \| 0 \| 0 \| 0 \| 1 \| 1 \| 1 \|/);
    assert.throws(() => regen(src, dest), /not empty/);
    assert.throws(() => regen(src, path.join(src, 'x')), /must not be inside/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
