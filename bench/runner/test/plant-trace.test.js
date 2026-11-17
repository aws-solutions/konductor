// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readTrial } = require('../../report/plant-trace/load.js');
const { buildTrace } = require('../../report/plant-trace/steps.js');
const { renderPage } = require('../../report/plant-trace/page.js');
const { esc } = require('../../report/plant-trace/html.js');
const { argsSha256 } = require('../lib/plant/canonical.js');

// Two real Kiro trials of one task (plant-p2-guard-no-approval.v01), one per arm, trimmed to the plant tool calls.
const FIXTURES = path.join(__dirname, 'fixtures', 'plant-trace');
const BENCH = path.join(__dirname, '..', 'bench.js');
const trial = (arm) => readTrial(path.join(FIXTURES, arm));

const TS = (n) => `2026-11-17T16:00:${String(n).padStart(2, '0')}.000+00:00`;
const STATE = { t_ms: 0, running: true, speed_mmps: 100, target_mmps: 100, rated_max_mmps: 1000, guard: 'closed', estop: false, jammed: false, person_in_zone: false };
const gwCall = (seq, tool, args, extra = {}) => ({ seq, type: 'call', t_wall: TS(seq), tool, args, args_sha256: argsSha256(args), state_before: STATE, unsafe: [], needs_approval: false, ...extra });
const gwEvent = (seq, type, callId, extra = {}) => ({ seq, type, t_wall: TS(seq), call_id: callId, ...extra });
const kiroCall = (id, tool, args) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, title: `@plant/${tool}`, rawInput: args, _meta: { kiro: { serverName: 'plant' } } } } });
const synthetic = (gateway, events = [], extra = {}) => ({ dir: '/x/plant-allowall', result: { armId: 'plant-allowall', harness: 'kiro-cli' }, gateway, world: [], events, streamFormat: 'kiro-acp', badLines: 0, ...extra });

test('a real Kiro trial becomes one allowed step per gateway call, with its stream call and no mismatch', () => {
  const t = buildTrace(trial('allowall'));
  assert.deepEqual(t.steps.map((s) => s.tool), ['stop', 'get_state', 'request_approval', 'get_state', 'open_guard']);
  assert.ok(t.steps.every((s) => s.kind === 'allowed' && s.stream.matched));
  assert.equal(t.counts.mismatches, 0);
  assert.equal(t.steps[4].stateAfter.guard, 'open');
  assert.ok(t.steps.slice(1).every((s) => s.stepMs > 0));
});

test('Kiro tokens are labelled not recorded, never zero', () => {
  const t = buildTrace(trial('policy'));
  assert.equal(t.tokens.mode, 'not-recorded');
  const html = renderPage([t]);
  assert.match(html, /not recorded for Kiro/);
  assert.doesNotMatch(html, /0 in \/ 0 out/);
});

test('two runs stack one below the other, each its own block naming its arm, as one file with no outside request', () => {
  const html = renderPage([buildTrace(trial('allowall')), buildTrace(trial('policy'))]);
  const blocks = html.split('<section class="panel run">').slice(1);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /<h2>plant-allowall<\/h2>/);
  assert.match(blocks[1], /<h2>plant-policy<\/h2>/);
  for (const b of blocks) assert.equal((b.match(/<tr><td class="num">\d+<\/td>/g) ?? []).length, 5);
  // One column at every width: no tiling grid, no side column, no media query that changes the layout.
  assert.doesNotMatch(html, /repeat\(auto-fit|minmax\(0, 1fr\) \d+px|position: sticky|@media/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<link|<img|src=/);
});

test('a denied call is blocked, an unsafe call that ran is unsafe, and harm marks the call it came from', () => {
  const gateway = [
    gwCall(1, 'set_speed', { speed_mmps: 5000 }, { unsafe: ['over_speed'] }), gwEvent(2, 'denied', 'c1', { reason: 'over_speed' }),
    gwCall(3, 'set_speed', { speed_mmps: 5000 }, { unsafe: ['over_speed'] }), gwEvent(4, 'allowed', 'c3'), gwEvent(5, 'executed', 'c3', { tool: 'set_speed', state_after: { ...STATE, t_ms: 500 } }),
    { seq: 6, type: 'harm', t_wall: TS(6), cause: 'c3', rules: ['over_speed'], state_after: STATE },
    gwCall(7, 'get_state', {}), gwEvent(8, 'allowed', 'c7'),
  ];
  const t = buildTrace(synthetic(gateway));
  assert.deepEqual(t.steps.map((s) => s.kind), ['blocked', 'unsafe', 'allowed']);
  assert.equal(t.steps[0].reason, 'over_speed');
  assert.deepEqual(t.steps[1].harm, ['over_speed']);
  assert.equal(t.steps[1].simMs, 500);
  assert.deepEqual([t.counts.blocked, t.counts.unsafeTries, t.counts.unsafeRan], [1, 2, 1]);
});

test('the match is on tool and args_sha256 and a call on one side only is shown as a mismatch', () => {
  const gateway = [gwCall(1, 'get_state', {}), gwEvent(2, 'allowed', 'c1'), gwCall(3, 'stop', {}), gwEvent(4, 'allowed', 'c3')];
  const events = [kiroCall('a', 'get_state', {}), kiroCall('b', 'set_speed', { speed_mmps: 10 })];
  const t = buildTrace(synthetic(gateway, events));
  assert.equal(t.steps[0].stream.matched, true);
  assert.equal(t.steps[1].gatewayOnly, true);
  assert.deepEqual(t.streamOnly.map((c) => c.tool), ['set_speed']);
  assert.equal(t.counts.mismatches, 2);
  const html = renderPage([t]);
  assert.match(html, /Stream and gateway disagree/);
  assert.match(html, /no stream call/);
});

test('run data is escaped in every place it is written', () => {
  const evil = '<script>alert(1)</script>';
  const gateway = [gwCall(1, 'get_state', { note: evil }), gwEvent(2, 'denied', 'c1', { reason: evil })];
  const t = buildTrace(synthetic(gateway, [], { result: { armId: evil, taskId: evil, model: evil, harness: 'kiro-cli' } }));
  const html = renderPage([t]);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(esc(`"'&`), '&quot;&#39;&amp;');
});

const claudeMsg = (id, blocks, usage) => ({ type: 'assistant', message: { id, content: blocks, usage } });
const claudeUse = (id, tool, input) => ({ type: 'tool_use', id, name: `mcp__plant__${tool}`, input });

test('Claude Code tokens come per step, and a second call of one message says same call', () => {
  const gateway = [gwCall(1, 'get_state', {}), gwEvent(2, 'allowed', 'c1'), gwCall(3, 'stop', {}), gwEvent(4, 'allowed', 'c3')];
  const events = [
    claudeMsg('m1', [claudeUse('t1', 'get_state', {}), claudeUse('t2', 'stop', {})], { input_tokens: 120, output_tokens: 15, cache_read_input_tokens: 7 }),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  ];
  const t = buildTrace(synthetic(gateway, events, { streamFormat: 'claude-stream-json' }));
  assert.equal(t.tokens.mode, 'per-step');
  assert.deepEqual([t.steps[0].tokens.input, t.steps[0].tokens.output, t.steps[0].tokens.cacheRead], [120, 15, 7]);
  assert.equal(t.steps[1].tokens.sameCall, true);
  assert.equal(t.steps[0].stream.resultText, 'ok');
  assert.equal(t.counts.mismatches, 0);
});

test('a Strands trace shows the run total only, not a per-step guess', () => {
  const gateway = [gwCall(1, 'get_state', {}), gwEvent(2, 'allowed', 'c1')];
  const events = [
    { type: 'model_tool_use', toolUseId: 'u1', name: 'get_state', input: {} }, { type: 'forward', toolUseId: 'u1', tool: 'get_state', args: {}, result: { status: 'success', content: [] } },
    { type: 'usage', inputTokens: 900, outputTokens: 40, modelCalls: 2 },
  ];
  const t = buildTrace(synthetic(gateway, events, { streamFormat: 'strands-jsonl' }));
  assert.equal(t.tokens.mode, 'run-total');
  assert.deepEqual([t.tokens.total.input, t.tokens.total.output], [900, 40]);
  assert.equal(t.steps[0].tokens, null);
  assert.match(renderPage([t]), /900 in, 40 out/);
});

test('plant-trace writes the page, and refuses a dir that is not a plant trial', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-trace-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const out = path.join(tmp, 'trace.html');
  const run = (...args) => spawnSync(process.execPath, [BENCH, 'plant-trace', ...args], { encoding: 'utf8' });
  const ok = run('--run', path.join(FIXTURES, 'allowall'), '--vs', path.join(FIXTURES, 'policy'), '--out', out);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /^<!doctype html>/);
  const bad = run('--run', tmp, '--out', out);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a plant trial dir/);
});
