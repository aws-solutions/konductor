// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js trace on synthetic Kiro (engine v2 and v3) and Claude Code streams. Files only; no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { buildTrace, renderMarkdown, locateRun, mentionsOf } = require('../lib/trace.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const jsonl = (events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

// ---- engine v3 fixture ----

const upd = (u, sessionId = 'sess_1') => ({ type: 'sessionUpdate', data: { sessionId, update: u } });
const chunk = (kind, text, execution = 'e1') => upd({ sessionUpdate: kind, content: { type: 'text', text }, _meta: { kiro: { executionId: execution, turnId: execution } } });
const call = (id, title, rawInput, kiro = {}) => upd({ sessionUpdate: 'tool_call', toolCallId: id, title, rawInput, _meta: { kiro } });
const done = (id, title, rawInput, rawOutput, status = 'completed', kiro = {}) => upd({ sessionUpdate: 'tool_call_update', toolCallId: id, title, status, rawInput, rawOutput, _meta: { kiro } });
const skillText = (name) => ({ items: [{ Json: { content: [{ type: 'text', text: JSON.stringify({ name, content: `# ${name}\n${'x'.repeat(40)}` }) }], isError: false } }] });

const V3_STREAM = [
  { type: 'runStarted', data: { engine: 'v3' } },
  chunk('agent_thought_chunk', 'Thinking about the task.'),
  chunk('agent_message_chunk', 'I will look at the docs first.'),
  call('t1', 'List Directory', { path: '/scratch/w-x/r-abc123/work/docs' }, { toolOrigin: 'acp' }),
  done('t1', 'List Directory', { path: '/scratch/w-x/r-abc123/work/docs' }, { message: 'Contents' }, 'completed', { toolOrigin: 'acp' }),
  call('s1', '@konductor-skills/find_skills', { query: 'design doc' }),
  done('s1', '@konductor-skills/find_skills', { query: 'design doc' }, { items: [{ Json: { content: [{ type: 'text', text: '[{"name":"design-doc-guidelines"}]' }], isError: false } }] }),
  call('g1', '@konductor-skills/get_skill', { name: 'design-doc-guidelines' }),
  done('g1', '@konductor-skills/get_skill', { name: 'design-doc-guidelines' }, skillText('design-doc-guidelines')),
  call('invoke_subagent_d1', 'Sub-agent: k-architect', { name: 'k-architect', prompt: '## Target agent\nk-architect\n\n## Task\nWrite the hold service design.' }, { kind: 'agent-subtask', agentSubtaskId: 'sub-1' }),
  call('c1', 'Read File', { path: '/scratch/w-x/r-abc123/work/docs/requirements.md' }, { agentSubtaskId: 'sub-1', toolOrigin: 'default' }),
  done('c1', 'Read File', { path: '/scratch/w-x/r-abc123/work/docs/requirements.md' }, { message: 'text' }, 'completed', { agentSubtaskId: 'sub-1' }),
  call('c2', 'Write File', { path: '/scratch/w-x/r-abc123/work/docs/design/hold-service.md', text: '# Design' }, { agentSubtaskId: 'sub-1', toolOrigin: 'default' }),
  done('c2', 'Write File', { path: '/scratch/w-x/r-abc123/work/docs/design/hold-service.md' }, { message: 'Created' }, 'completed', { agentSubtaskId: 'sub-1' }),
  chunk('agent_message_chunk', 'Writing the document now.', 'e1'),
  done('invoke_subagent_d1', 'Sub-agent: k-architect', { name: 'k-architect' }, { message: 'Design written to docs/design/hold-service.md' }, 'completed', { kind: 'agent-subtask', agentSubtaskId: 'sub-1' }),
  chunk('agent_message_chunk', 'Done. The design is in place.'),
  upd({ sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', executionId: 'e1', turnId: 'e1', elapsedTime: 12500, promptTurnSummaries: [{ unit: 'credit', usage: 1.25 }] } } }),
  { type: 'runFinished', data: { sessionId: 'sess_1', status: 'success', stopReason: 'end_turn', finalText: 'Done. The design is in place.' } },
];

function runDir(root, { stream, result = {}, installed = undefined, name = 'run' } = {}) {
  const dir = path.join(root, name, 'konductor', 't1', '1');
  write(path.join(dir, 'stream.jsonl'), jsonl(stream));
  write(path.join(dir, 'result.json'), JSON.stringify({ armId: 'konductor', taskId: 't1', replicate: 1, harness: 'kiro-cli', status: 'success', wallClockMs: 15000, credits: 1.25, flags: ['transcriptPartial'], model: 'm', ...result }));
  write(path.join(dir, 'command.txt'), 'kiro-cli "chat" "--agent-engine" "v3" "Write the hold service design."\n');
  if (installed) write(path.join(dir, 'installed-agent.json'), JSON.stringify(installed));
  return dir;
}

const INSTALLED = {
  name: 'konductor', prompt: 'You route work.\nSpawn `k-architect` for design artifacts.\nUse delegation-protocol.',
  mcpServers: { 'konductor-skills': { command: 'x', args: ['--skill-name-filter', 'design-doc-guidelines,delegation-protocol,verification'] } },
};

test('a v3 stream becomes an ordered timeline with skills, a delegation, its return, files and turn totals', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: V3_STREAM, installed: INSTALLED });
    const t = buildTrace(dir);
    const kinds = t.entries.map((e) => e.kind);
    assert.deepEqual(kinds.filter((k) => k !== 'thought'), ['start', 'assistant', 'tool', 'skill-find', 'skill-load', 'delegate', 'tool', 'tool', 'assistant', 'delegate-return', 'assistant', 'turn-end', 'final']);
    const find = t.entries.find((e) => e.kind === 'skill-find');
    assert.equal(find.input.query, 'design doc');
    const load = t.entries.find((e) => e.kind === 'skill-load');
    assert.equal(load.input.name, 'design-doc-guidelines');
    assert.ok(load.result.length > 0);
    const del = t.entries.find((e) => e.kind === 'delegate');
    assert.equal(del.target, 'k-architect');
    assert.match(del.input.prompt, /Write the hold service design/);
    assert.deepEqual(t.entries.filter((e) => e.kind === 'tool' && e.agent === 'k-architect').map((e) => e.tool), ['read_file', 'fs_write']);
    const ret = t.entries.find((e) => e.kind === 'delegate-return');
    assert.equal(ret.agent, 'root');
    assert.match(ret.text, /Design written/);
    const mid = t.entries.find((e) => e.kind === 'assistant' && /Writing the document/.test(e.text));
    assert.equal(mid.agent, 'k-architect', 'a message while one delegation is open belongs to that agent');
    const end = t.entries.find((e) => e.kind === 'turn-end');
    assert.deepEqual([end.elapsedMs, end.credits], [12500, 1.25]);
    assert.deepEqual(t.header.filesWritten.map((f) => [f.agent, f.path]), [['k-architect', './docs/design/hold-service.md']]);
    assert.deepEqual(t.header.spawnTree.map((s) => [s.parent, s.target, s.toolCalls]), [['root', 'k-architect', 2]]);
    assert.equal(t.prompt, 'Write the hold service design.');
  } finally { cleanup(root); }
});

test('the header names the entry agent, skills listed against loaded, flags and exactly what is missing', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: V3_STREAM, installed: INSTALLED, result: { agent: 'konductor' } });
    const h = buildTrace(dir).header;
    assert.equal(h.entryAgent, 'konductor');
    assert.equal(h.skillsListed.summary, "3 skills in the installed agent's filter");
    assert.deepEqual(h.skillsListed.names, ['design-doc-guidelines', 'delegation-protocol', 'verification']);
    assert.deepEqual(h.skillsLoaded, ['design-doc-guidelines']);
    assert.equal(h.skillFindCalls, 1);
    assert.equal(h.transcript.partial, true);
    assert.match(h.transcript.missing[0], /no session files were saved/);
    assert.deepEqual(h.flags, ['transcriptPartial']);
    assert.equal(h.wallClockMs, 15000);
    assert.equal(h.credits, 1.25);
    write(path.join(dir, 'session/sess_1/messages.jsonl'), '{}\n');
    const withSessions = buildTrace(dir).header.transcript;
    assert.deepEqual(withSessions.sessionFiles, ['sess_1/messages.jsonl']);
    assert.match(withSessions.missing[0], /session files were saved \(1\)/);
  } finally { cleanup(root); }
});

test('a v3 call to a skill tool before it is loaded is shown as refused, not as a load', () => {
  const root = tmp();
  try {
    const stream = [
      { type: 'runStarted', data: { engine: 'v3' } },
      call('g0', 'get_skill', { name: 'verification' }),
      done('g0', 'get_skill', { name: 'verification' }, { message: 'tool not loaded' }, 'failed'),
      { type: 'runFinished', data: { status: 'success', finalText: 'x' } },
    ];
    const t = buildTrace(runDir(root, { stream }));
    const load = t.entries.find((e) => e.kind === 'skill-load');
    assert.equal(load.deferred, true);
    assert.deepEqual(t.header.skillsLoaded, []);
    assert.match(renderMarkdown(t), /LOAD SKILL {2}verification {2}\(refused: tool not loaded yet\)/);
  } finally { cleanup(root); }
});

// ---- engine v2 ----

const v2call = (id, toolName, rawInput, extra = {}) => upd({ sessionUpdate: 'tool_call', toolCallId: id, rawInput, _meta: { kiro: { toolName, ...extra } } }, 's1');
const v2done = (id, rawOutput) => upd({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput }, 's1');

test('a v2 stream gives the skill load, the named delegation and the metered turn', () => {
  const root = tmp();
  try {
    const stream = [
      { type: 'runStarted', data: { engine: 'v2' } },
      v2call('a', 'get_skill', { name: 'verification' }, { mcpServerName: 'konductor-skills' }),
      v2done('a', skillText('verification')),
      v2call('b', 'subagent', { role: 'k-developer', task: 'fix it' }),
      v2done('b', { message: 'fixed' }),
      v2call('c', 'fs_write', { path: '/scratch/w/r-zzz/work/a.txt' }),
      { type: 'metadata', data: { sessionId: 's1', turnDurationMs: 4000, meteringUsage: [{ value: 0.5, unit: 'credit' }] } },
      { type: 'runFinished', data: { sessionId: 's1', status: 'success', finalText: 'ok' } },
    ];
    const t = buildTrace(runDir(root, { stream }));
    assert.deepEqual(t.entries.map((e) => e.kind), ['start', 'skill-load', 'delegate', 'delegate-return', 'tool', 'turn-end', 'final']);
    assert.equal(t.entries[2].target, 'k-developer');
    assert.deepEqual(t.entries.find((e) => e.kind === 'turn-end').credits, 0.5);
    assert.deepEqual(t.header.skillsLoaded, ['verification']);
    assert.equal(t.header.skillsListed.summary, 'unknown (no installed-agent.json in the run directory)');
    assert.equal(t.header.filesWritten[0].path, './a.txt');
  } finally { cleanup(root); }
});

// ---- Claude Code ----

const A = (content, extra = {}) => ({ type: 'assistant', message: { content }, ...extra });
const U = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });

const CC_STREAM = [
  { type: 'system', subtype: 'init', model: 'claude-x', slash_commands: ['verification', 'plan-review'] },
  A([{ type: 'text', text: 'Reading the docs.' }]),
  A([{ type: 'tool_use', id: 'u1', name: 'Skill', input: { skill: 'verification' } }]),
  U([{ type: 'tool_result', tool_use_id: 'u1', content: 'Launching skill: verification' }]),
  A([{ type: 'tool_use', id: 'u2', name: 'Agent', input: { subagent_type: 'k-architect', description: 'design', prompt: 'TARGET AGENT: k-architect\nTASK: write it' } }]),
  A([{ type: 'tool_use', id: 'u3', name: 'Write', input: { file_path: '/scratch/w/r-aaa/work/docs/design/hold-service.md', content: '# D' } }], { parent_tool_use_id: 'u2' }),
  U([{ type: 'tool_result', tool_use_id: 'u3', content: 'File created' }], { parent_tool_use_id: 'u2' }),
  { type: 'system', subtype: 'task_notification', tool_use_id: 'u2', status: 'completed', summary: 'Wrote the design.' },
  U([{ type: 'tool_result', tool_use_id: 'u2', content: [{ type: 'text', text: 'Subagent done' }] }]),
  A([{ type: 'text', text: 'All done.' }]),
  { type: 'result', subtype: 'success', stop_reason: 'end_turn', total_cost_usd: 0.42, duration_ms: 90000, num_turns: 4, result: 'All done.' },
];

test('a Claude Code stream gives the Skill load, the Agent delegation with its summary, and the final cost', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: CC_STREAM, result: { harness: 'claude-code', credits: null, costUsd: 0.42, flags: [] } });
    const t = buildTrace(dir);
    assert.equal(t.run.harness, 'claude-code');
    assert.deepEqual(t.entries.map((e) => e.kind), ['start', 'assistant', 'skill-load', 'delegate', 'tool', 'delegate-return', 'assistant', 'final']);
    assert.equal(t.entries.find((e) => e.kind === 'tool').agent, 'k-architect');
    assert.equal(t.entries.find((e) => e.kind === 'delegate-return').text, 'Wrote the design.');
    assert.deepEqual(t.header.skillsLoaded, ['verification']);
    assert.equal(t.header.skillsListed.summary, '2 slash commands in the session init (skills are offered by name)');
    assert.equal(t.header.transcript.partial, false);
    assert.equal(t.entries.at(-1).costUsd, 0.42);
    const md = renderMarkdown(t);
    assert.match(md, /DELEGATE -> k-architect {2}brief \d+ bytes: TARGET AGENT: k-architect TASK: write it/);
    assert.match(md, /cost: \$0\.4200/);
  } finally { cleanup(root); }
});

test('an opencode run is refused with a plain message', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: [{ type: 'text', part: { text: 'x' } }], result: { harness: 'opencode' } });
    assert.throws(() => buildTrace(dir), /opencode run/);
  } finally { cleanup(root); }
});

// ---- rendering ----

test('the markdown hides thoughts and shortens long text unless --full is asked for', () => {
  const root = tmp();
  try {
    const long = 'word '.repeat(200);
    const stream = [{ type: 'runStarted', data: { engine: 'v3' } }, chunk('agent_thought_chunk', 'secret reasoning'), chunk('agent_message_chunk', long), { type: 'runFinished', data: { status: 'success', finalText: long } }];
    const t = buildTrace(runDir(root, { stream }));
    const short = renderMarkdown(t);
    assert.doesNotMatch(short, /secret reasoning/);
    assert.match(short, /1 thought block\(s\) hidden/);
    assert.match(short, /\.\.\.\n/);
    const full = renderMarkdown(t, { full: true });
    assert.match(full, /secret reasoning/);
    assert.ok(full.includes(long.trim()));
  } finally { cleanup(root); }
});

// ---- locating a run ----

test('locateRun finds a run in a multi-arm directory and in a 2x2 cell, and lists what exists when it cannot', () => {
  const root = tmp();
  try {
    const dir = runDir(root, { stream: V3_STREAM });
    const base = path.join(root, 'run');
    assert.equal(locateRun(base, { arm: 'konductor', task: 't1', rep: 1 }), dir);
    const cell = path.join(root, 'twobytwo', 'cells', 'kiro-konductor', 't1', 'konductor', 't1', '1');
    write(path.join(cell, 'result.json'), '{}');
    assert.equal(locateRun(path.join(root, 'twobytwo'), { arm: 'kiro-konductor', task: 't1', rep: 1 }), cell);
    assert.throws(() => locateRun(base, { arm: 'nope', task: 't1', rep: 1 }), /no run nope\/t1\/1 in .*runs present: konductor\/t1\/1/);
  } finally { cleanup(root); }
});

// ---- instructions ----

test('mentionsOf finds whole-word mentions with their line numbers and the entry agent\'s skill list', () => {
  const sources = [{ label: 'prompt', lines: ['a', 'Use delegation-protocol here', 'verification-extra is another name', 'run verification now'] }];
  sources.listedSkills = ['verification'];
  const m = mentionsOf(sources, 'verification');
  assert.equal(m.total, 1);
  assert.deepEqual(m.hits.map((h) => [h.source, h.line]), [['prompt', 4]]);
  assert.equal(m.listed.length, 1);
  assert.equal(mentionsOf(sources, 'absent').total, 0);
});

test('--instructions reads the installed prompt and the arm commit and marks the result INFERRED', () => {
  const root = tmp();
  try {
    const repo = path.join(root, 'repo');
    write(path.join(repo, 'agents/konductor.agent-spec.json'), JSON.stringify({
      config: { systemPrompt: 'Line one\nRoute design artifacts to k-architect.\nLine three' },
      dependencies: { skills: { skillNames: ['delegation-protocol', 'design-doc-guidelines'] }, context: { contextNames: ['k-rules.md'] } },
    }));
    write(path.join(repo, 'context/k-rules.md'), 'Rule A\nAfter design work, load design-doc-guidelines.\n');
    write(path.join(repo, 'skills/delegation-protocol/SKILL.md'), 'Registry\n- k-architect: designs\n');
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { env, encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    assert.equal(git('add', '.').status, 0);
    assert.equal(git('commit', '-q', '-m', 'x').status, 0);
    const sha = git('rev-parse', 'HEAD').stdout.trim();
    const dir = runDir(root, { stream: V3_STREAM, installed: INSTALLED, result: { commitSha: sha } });
    const t = buildTrace(dir, { instructions: true, repoRoot: repo });
    const del = t.entries.find((e) => e.kind === 'delegate');
    const where = del.instructions.hits.map((h) => `${h.source.split(' @')[0]}:${h.line}`);
    assert.ok(where.includes('installed-agent.json prompt:2'), where.join());
    assert.ok(where.includes(`agents/konductor.agent-spec.json systemPrompt:2`), where.join());
    assert.ok(where.includes('skills/delegation-protocol/SKILL.md:2'), where.join());
    const load = t.entries.find((e) => e.kind === 'skill-load');
    assert.ok(load.instructions.listed.length === 1);
    assert.ok(load.instructions.hits.some((h) => h.source.startsWith('context/k-rules.md') && h.line === 2));
    const md = renderMarkdown(t);
    assert.match(md, /INFERRED, instruction text that mentions "k-architect"/);
    assert.match(md, /Instruction sources searched \(INFERRED/);
    const noRepo = buildTrace(dir, { instructions: true, repoRoot: path.join(root, 'missing') });
    assert.deepEqual(noRepo.header.instructionSources, ['installed-agent.json prompt']);
  } finally { cleanup(root); }
});

// ---- command line ----

test('bench.js trace prints markdown or json, and refuses a missing run or flag', () => {
  const root = tmp();
  try {
    runDir(root, { stream: V3_STREAM, installed: INSTALLED });
    const base = [BENCH_JS, 'trace', '--run', path.join(root, 'run'), '--arm', 'konductor', '--task', 't1', '--rep', '1'];
    const env = { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR };
    const md = spawnSync(process.execPath, base, { encoding: 'utf8', env });
    assert.equal(md.status, 0, md.stderr);
    assert.match(md.stdout, /^# Trace: konductor \/ t1 \/ rep 1/);
    assert.match(md.stdout, /DELEGATE -> k-architect/);
    const json = spawnSync(process.execPath, [...base, '--format', 'json'], { encoding: 'utf8', env });
    assert.equal(JSON.parse(json.stdout).header.entryAgent, 'konductor');
    const missing = spawnSync(process.execPath, [BENCH_JS, 'trace', '--run', path.join(root, 'run'), '--arm', 'konductor'], { encoding: 'utf8', env });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /trace needs --task/);
    const none = spawnSync(process.execPath, [...base.slice(0, -1), '9'], { encoding: 'utf8', env });
    assert.match(none.stderr, /no run konductor\/t1\/9/);
  } finally { cleanup(root); }
});
