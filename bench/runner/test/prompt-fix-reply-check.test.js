// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rc = require('../../ops/prompt-fixes/reply-check.js');
const { parseStream } = require('../lib/stream.js');

const upd = (update, sub = false) => ({ type: 'sessionUpdate', data: { sessionId: 's1', update: { ...update, ...(sub ? { _meta: { kiro: { kind: 'agent-subtask' } } } : {}) } } });
const say = (text, sub) => upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, sub);
const tool = (title, kind, rawInput, sub) => upd({ sessionUpdate: 'tool_call', toolCallId: title.startsWith('Sub-agent') ? 'invoke_subagent_1' : 'run_1', title, kind, rawInput }, sub);

test('expectationsFor: a team task gets all seven checks; a proceed task skips the plan word and the action', () => {
  const team = rc.expectationsFor('t12-mux-parallel-merge').map((e) => e.id);
  assert.deepEqual(team, ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']);
  const proceed = rc.expectationsFor('probe-e2e-explicit-yes').map((e) => e.id);
  assert.deepEqual(proceed, ['E1', 'E2', 'E4', 'E6']);
  assert.match(rc.expectationsFor('t1-bug-date-range').find((e) => e.id === 'E3').text, /solo/);
  assert.throws(() => rc.expectationsFor('no-such-task'), /not in expect.json/);
});

test('timeline: root text and tool calls in order; subagent events and read-only commands are not acts', () => {
  const events = [say('Orchestration: auto (default)\n'), tool('Run Command', 'execute', { command: 'git status --short; ls' }),
    say('child', true), tool('Run Command', 'execute', { command: 'echo x > a.txt' }, true),
    say('Plan: solo, because 1 part\n'), tool('Run Command', 'execute', { command: "sed -i 's/a/b/' src/x.js" }), tool('Sub-agent: k-developer', 'other', { name: 'k-developer' })];
  const t = rc.timeline(events);
  assert.equal(t.text, 'Orchestration: auto (default)\nPlan: solo, because 1 part\n');
  assert.deepEqual(t.tools.map((x) => [x.act, x.spawn]), [[false, false], [true, false], [false, true]]);
  assert.equal(t.firstActAt, 'Orchestration: auto (default)\nPlan: solo, because 1 part\n'.length);
});

test('scoreRun: the smoke t12 shape (no Plan line, no Skills line, solo work, a reviewer, a gate line) fails E1 to E5 and passes E6, E7', () => {
  const events = [say('Orchestration: auto (default)\n\nLet me look at the repo first.'), tool('Run Command', 'execute', { command: 'ls' }),
    tool('Run Command', 'execute', { command: 'git worktree add -b mux-1 ../wt main' }), tool('Sub-agent: k-developer', 'other', { name: 'k-developer', prompt: 'Review only' }),
    say('All merged.\n\nReview gate: ran k-developer')];
  const s = rc.scoreRun({ events, orch: { makerSpawns: 0, reviewerSpawns: 1 }, taskId: 't12-mux-parallel-merge' });
  const met = Object.fromEntries(s.checks.map((c) => [c.id, c.met]));
  assert.deepEqual(met, { E1: false, E2: false, E3: false, E4: false, E5: false, E6: true, E7: true });
  assert.equal(s.toolsBeforeFirstAct, 1);
});

test('scoreRun: a Plan and Skills line written before the first act pass; after it, E2 and E4 fail', () => {
  const early = [say('Orchestration: auto (default)\nPlan: solo, because 2 files\nSkills: none fit\n'), tool('Edit', 'edit', { path: 'src/a.js' }), say('Done.\nReview gate: not needed, one file, 1 file +2 -1')];
  const s = rc.scoreRun({ events: early, orch: { makerSpawns: 0, reviewerSpawns: 0 }, taskId: 't1-bug-date-range' });
  assert.deepEqual(s.checks.map((c) => c.met), [true, true, true, true, true, true, true]);
  const late = [say('Orchestration: auto (default)\n'), tool('Edit', 'edit', { path: 'src/a.js' }), say('Plan: solo, because 2 files\nSkills: none fit\n')];
  const l = rc.scoreRun({ events: late, orch: { makerSpawns: 0, reviewerSpawns: 0 }, taskId: 't1-bug-date-range', stopped: true });
  const met = Object.fromEntries(l.checks.map((c) => [c.id, c.met]));
  assert.equal(met.E1, true);
  assert.equal(met.E2, false);
  assert.equal(met.E4, false);
  assert.equal(met.E6, null, 'an early-stopped run never reached its final reply');
  assert.equal(met.E7, null);
});

// Cut from the reply check's real stream candidate.t12-split-shared-file r2 (2026-11-28): the placeholder message ends
// `Skills: none fit` with no line break and the next message, after a read-only tool call, opens `Plan: solo, because`.
const fixtureEvents = (name) => parseStream(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')).events;

test('scoreRun on a real stream: the placeholder then `Plan: solo, because ...` in the next message meets E1 to E4', () => {
  const events = fixtureEvents('plan-line-t12-split-r2.stream.jsonl');
  const s = rc.scoreRun({ events, orch: { makerSpawns: 0, reviewerSpawns: 0 }, taskId: 't12-split-shared-file', stopped: true });
  const met = Object.fromEntries(s.checks.map((c) => [c.id, c.met]));
  assert.deepEqual([met.E1, met.E2, met.E3, met.E4], [true, true, true, true]);
  assert.match(s.checks[0].evidence, /^Plan: solo, because both tickets/);
  assert.equal(s.checks.find((c) => c.id === 'E4').evidence, 'Skills: none fit');
});

test('scoreRun: E2 is judged where the solo or team line is, not where the placeholder is', () => {
  const events = [say('Plan: after a read-only look\nSkills: none fit'), tool('Run Command', 'execute', { command: 'ls' }), tool('Edit', 'edit', { path: 'src/a.js' }), say('Plan: solo, because 1 file')];
  const met = Object.fromEntries(rc.scoreRun({ events, orch: { makerSpawns: 0, reviewerSpawns: 0 }, taskId: 't1-bug-date-range', stopped: true }).checks.map((c) => [c.id, c.met]));
  assert.deepEqual([met.E1, met.E2, met.E3, met.E4], [true, false, true, true]);
});

test('reviewPrompt: names every expectation id, carries the transcript, and asks for JSON only', () => {
  const p = rc.reviewPrompt({ taskId: 't1-bug-date-range', taskPrompt: 'Fix the date bug.', transcript: 'TEXT: hello\nTOOL: Run Command ls' });
  for (const e of rc.expectationsFor('t1-bug-date-range')) assert.ok(p.includes(`${e.id}: ${e.text}`));
  assert.match(p, /TEXT: hello/);
  assert.match(p, /Reply with JSON only/);
  const ok = rc.checkReview({ checks: rc.expectationsFor('t1-bug-date-range').map((e) => ({ id: e.id, verdict: 'met', quote: 'x' })), decisionInOtherWords: 'solo' }, 't1-bug-date-range');
  assert.equal(ok.ok, true);
  assert.equal(rc.checkReview({ checks: [{ id: 'E1', verdict: 'maybe', quote: '' }] }, 't1-bug-date-range').ok, false);
});

test('paidPlan: counts runs, the Claude reviewer at 15 credits a call and the panel in USD with one retry each', () => {
  const p = rc.paidPlan({ tasks: ['t12-mux-parallel-merge', 't1-bug-date-range'], reps: 3, runLimit: 6, existing: 2, promptKChars: 10 });
  assert.equal(p.runs, 6);
  assert.equal(p.runCredits, 36);
  assert.equal(p.outputs, 8);
  assert.equal(p.claudeCalls, 8);
  assert.equal(p.claudeCredits, 120);
  assert.equal(p.panelCalls, 24);
  assert.equal(p.panelCallsWorst, 48);
  assert.ok(p.panelUsdHigh > p.panelUsdMid && p.panelUsdMid > 0);
  assert.deepEqual(p.panel, ['gpt-5.6-luna', 'deepseek-3.2', 'qwen3-coder-next']);
});
