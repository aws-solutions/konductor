// SPDX-License-Identifier: Apache-2.0
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('../lib/stream.js');
const cc = require('../lib/harness/claude-code-parse.js');

const FIX = path.join(__dirname, 'fixtures', 'claude-code');
const names = fs.readdirSync(FIX).filter((f) => f.endsWith('.stream.jsonl')).map((f) => f.replace('.stream.jsonl', ''));
const load = (name) => parseStream(fs.readFileSync(path.join(FIX, `${name}.stream.jsonl`), 'utf8')).events;
const agg = (name, opts = { expectedModel: 'claude-sonnet-5-5' }) => cc.aggregateEvents(load(name), opts);

test('canonicalModelOf strips the inference profile prefix and keeps a canonical id', () => {
  assert.equal(cc.canonicalModelOf('us.anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('global.anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf(''), null);
});

test('every fixture aggregates without throwing and has the common fields', () => {
  assert.ok(names.length >= 10);
  for (const n of names) {
    const a = agg(n);
    assert.ok(Array.isArray(a.sessionIds), n);
    assert.ok(a.tokens && Object.values(a.tokens).every((v) => Number.isInteger(v) && v >= 0), n);
    assert.ok(a.toolCalls >= 0 && a.subagentCalls >= 0 && a.workToolCalls >= 0, n);
    assert.ok(['success', 'error', null].includes(a.runFinishedStatus), n);
    assert.equal(a.toolCalls, Object.values(a.toolNames).reduce((x, y) => x + y, 0), n);
    assert.equal(a.workToolCalls, a.toolCalls - a.subagentCalls, n);
  }
});

test('vanilla success: cost, tokens, model identity, final text', () => {
  const a = agg('vanilla-success');
  assert.equal(a.runFinishedStatus, 'success');
  assert.equal(a.stopReason, 'end_turn');
  assert.equal(a.terminalReason, 'completed');
  assert.equal(a.costUsd, 0.0437613);
  assert.equal(a.costBasis, 'list');
  assert.equal(a.costCensored, false);
  assert.equal(a.finalText, 'hi');
  assert.ok(a.sessionId);
  assert.ok(a.turnDurationMs > 0);
  assert.deepEqual(a.modelIdentity.canonicalModels, ['claude-sonnet-5-5']);
  assert.equal(a.modelIdentity.ok, true);
  assert.equal(a.toolNames.Bash, 1);
  assert.equal(a.subagentCalls, 0);
  assert.equal(a.tokens.total, a.tokens.input + a.tokens.output + a.tokens.cacheRead + a.tokens.cacheWrite);
  assert.ok(a.tokens.output > 0);
});

test('tokens come from modelUsage, summed over the keys', () => {
  const a = agg('delegation-dashed-pin');
  assert.deepEqual(a.tokens, { input: 12, output: 695, reasoning: 0, cacheRead: 127968, cacheWrite: 59735, total: 12 + 695 + 127968 + 59735 });
  assert.deepEqual(a.modelUsageKeys.sort(), ['claude-sonnet-5-5', 'us.anthropic.claude-sonnet-5-5']);
});

test('dashed pin delegation: two keys, one canonical model, two result events, one init counted', () => {
  const a = agg('delegation-dashed-pin');
  assert.equal(a.resultCount, 2);
  assert.equal(a.initCount, 2);
  assert.equal(a.runFinishedStatus, 'success');
  assert.equal(a.costUsd, 0.16910830000000002);
  assert.equal(a.modelIdentity.ok, true);
  assert.deepEqual(a.modelIdentity.canonicalModels, ['claude-sonnet-5-5']);
  assert.deepEqual(a.modelIdentity.messageModels, ['claude-sonnet-5-5']);
  assert.equal(a.spawn.spawned, 1);
  assert.equal(a.spawn.failed, 0);
  assert.equal(a.spawn.maxDepth, 1);
  assert.equal(a.subagentCalls, 1);
  assert.deepEqual(a.delegatedTo, { 'k-researcher': 1 });
  assert.equal(a.hooks.length, 2);
  assert.deepEqual(a.hooks.map((h) => h.subtype), ['hook_started', 'hook_response']);
  assert.equal(a.hooks[1].outcome, 'success');
  assert.equal(a.turnDurationMs, 6508 + 1276);
  assert.equal(a.init.agents.includes('konductor'), true);
});

test('failed spawn then retry: spawned counts both, one failed', () => {
  const a = agg('spawn-failed-then-retry');
  assert.equal(a.spawn.spawned, 2);
  assert.equal(a.spawn.failed, 1);
  assert.equal(a.subagentCalls, 2);
  assert.deepEqual(a.tasks.map((t) => t.status), ['failed', 'completed']);
});

test('a retry on another model is a model mismatch, judged on canonical ids and not on keys', () => {
  const a = agg('opus-fallback');
  assert.equal(a.modelIdentity.ok, false);
  assert.ok(a.modelIdentity.canonicalModels.includes('claude-opus-5-5'));
  assert.ok(a.modelIdentity.offending.includes('claude-opus-5-5'));
});

test('without an expected model the identity check reports the models and does not judge', () => {
  const a = agg('opus-fallback', {});
  assert.equal(a.modelIdentity.ok, null);
});

test('permission denial: exit-0 style success with a denial recorded', () => {
  const a = agg('permission-denied');
  assert.equal(a.runFinishedStatus, 'success');
  assert.equal(a.permissionDenials.length, 1);
  assert.equal(a.permissionDenials[0].tool, 'Write');
  assert.ok(a.permissionDeniedEvents >= 1);
});

test('HTTP 400 stream: error, no cost, api kind', () => {
  const a = agg('model-400');
  assert.equal(a.runFinishedStatus, 'error');
  assert.equal(a.terminalReason, 'api_error');
  assert.equal(a.errorKind, 'api');
  assert.equal(a.costUsd, 0);
  assert.equal(a.costCensored, false);
  assert.match(a.finalText, /400/);
});

test('credential error is its own kind so the runner can call it an infra error', () => {
  const a = agg('synthetic-credential-error');
  assert.equal(a.runFinishedStatus, 'error');
  assert.equal(a.errorKind, 'credentials');
  assert.equal(a.retries.cloud_credential_error, 2);
});

test('credential retries and nothing else, with no result line, are still a credentials error', () => {
  const retry = (n) => ({ type: 'system', subtype: 'api_retry', attempt: n, max_retries: 2, error: 'cloud_credential_error', session_id: 's1' });
  const only = cc.aggregateEvents([retry(1), retry(2)], { expectedModel: 'claude-sonnet-5-5' });
  assert.equal(only.resultCount, 0);
  assert.equal(only.errorKind, 'credentials');
  assert.equal(only.retries.cloud_credential_error, 2);
  const killed = agg('synthetic-credential-error-killed');
  assert.equal(killed.errorKind, 'credentials');
  const withReply = cc.aggregateEvents([retry(1), { type: 'assistant', message: { id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } } }], { expectedModel: 'claude-sonnet-5-5' });
  assert.equal(withReply.errorKind, null, 'a run that got a reply from the model is not a credentials failure');
  assert.equal(agg('sigterm').errorKind, null);
});

test('SIGTERM stream: no result, censored, tokens from assistant usage, no cost without rates', () => {
  const a = agg('sigterm');
  assert.equal(a.runFinishedStatus, null);
  assert.equal(a.finalText, null);
  assert.equal(a.costCensored, true);
  assert.equal(a.costUsd, null);
  assert.ok(a.tokens.cacheRead > 0 && a.tokens.cacheWrite > 0);
  assert.equal(a.toolNames.Bash, 1);
});

test('SIGTERM stream with rates: priced as a lower bound', () => {
  const rates = { 'claude-sonnet-5-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
  const a = agg('sigterm', { expectedModel: 'claude-sonnet-5-5', rates });
  const t = a.tokens;
  const want = (t.input * 3 + t.output * 15 + t.cacheRead * 0.3 + t.cacheWrite * 3.75) / 1e6;
  assert.ok(Math.abs(a.costUsd - want) < 1e-12);
  assert.equal(a.costCensored, true);
});

test('duplicate assistant events of one message count once', () => {
  const ev = (id, out) => ({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 } }, parent_tool_use_id: null });
  const a = cc.aggregateEvents([ev('m1', 5), ev('m1', 9), ev('m2', 4)], {});
  assert.deepEqual(a.tokens, { input: 2, output: 13, reasoning: 0, cacheRead: 4, cacheWrite: 6, total: 25 });
  assert.equal(a.modelCalls, 2);
});

test('synthetic assistant messages are ignored by the identity check', () => {
  const events = [
    { type: 'assistant', message: { id: 'a', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }], usage: {} }, parent_tool_use_id: null },
    { type: 'assistant', message: { id: 'b', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null },
    { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, modelUsage: { 'us.anthropic.claude-sonnet-5-5': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01, canonicalModel: 'claude-sonnet-5-5' } }, duration_ms: 10 },
  ];
  const a = cc.aggregateEvents(events, { expectedModel: 'claude-sonnet-5-5' });
  assert.equal(a.modelIdentity.ok, true);
  assert.deepEqual(a.modelIdentity.messageModels, ['claude-sonnet-5-5']);
});

test('a result line with an error subtype is an error with that stop reason', () => {
  const a = cc.aggregateEvents([{ type: 'result', subtype: 'error_max_budget_usd', is_error: false, total_cost_usd: 0.5, modelUsage: {}, result: '' }], {});
  assert.equal(a.runFinishedStatus, 'error');
  assert.equal(a.stopReason, 'error_max_budget_usd');
});

test('AskUserQuestion is the one tool that marks a question to the user', () => {
  const base = [
    { type: 'assistant', message: { id: 'q', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [] } }], usage: {} }, parent_tool_use_id: null },
    { type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0, modelUsage: {} },
  ];
  assert.equal(cc.aggregateEvents(base, {}).askedUser, true);
  assert.equal(cc.aggregateEvents(base.slice(1), {}).askedUser, false);
  assert.equal(cc.aggregateEvents(base.slice(0, 1), {}).askedUser, null);
});

test('askedUser on a normal run falls back to the final-text detector', () => {
  const a = agg('vanilla-success');
  assert.equal(a.askedUser, false);
});

test('spawn tree: depth from the parent chain, outputs from the notification, input carries the agent name', () => {
  const t = cc.spawnTree(load('delegation-dashed-pin'));
  assert.equal(t.spawnCalls, 1);
  assert.equal(t.spawns, 1);
  assert.equal(t.maxSpawnDepth, 1);
  assert.equal(t.childSessions, 1);
  assert.equal(t.calls[0].depth, 1);
  assert.equal(t.calls[0].input.agent, 'k-researcher');
  assert.equal(t.calls[0].closed, true);
  assert.equal(t.calls[0].status, 'completed');
  assert.match(t.calls[0].output, /greet/);
});

test('spawn tree: nested agent calls take the depth of the call that made them', () => {
  const asst = (id, parent, name, extra = {}) => ({ type: 'assistant', parent_tool_use_id: parent, agent_id: parent ? `ag-${parent}` : undefined, message: { id: `m-${id}`, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name, input: { subagent_type: extra.type ?? 'k-developer', prompt: 'p' } }], usage: {} } });
  const t = cc.spawnTree([asst('a1', null, 'Agent'), asst('a2', 'a1', 'Agent', { type: 'k-researcher' }), asst('a3', null, 'Agent')]);
  assert.deepEqual(t.calls.map((c) => c.depth), [1, 2, 1]);
  assert.equal(t.maxSpawnDepth, 2);
});

test('skill events: a Skill call, the body message that follows, and a SKILL.md read', () => {
  const c = cc.skillCalls(load('delegation-dashed-pin'));
  assert.equal(c.length, 1);
  assert.equal(c[0].tool, 'skill');
  assert.equal(c[0].input.name, 'delegation-protocol');
  assert.equal(c[0].status, 'ok');
  assert.ok(Buffer.byteLength(c[0].text) > 1000);

  const read = [
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'r', model: 'x', content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: '/h/.claude/skills/backend-review/SKILL.md' } }], usage: {} } },
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: '# Backend review\nbody' }] } },
  ];
  const r = cc.skillCalls(read);
  assert.equal(r.length, 1);
  assert.equal(r[0].input.name, 'backend-review');
  assert.equal(r[0].via, 'read-skill-md');
});

test('the aggregate is deterministic and does not modify its input', () => {
  const events = load('delegation-dashed-pin');
  const before = JSON.stringify(events);
  const a1 = JSON.stringify(cc.aggregateEvents(events, { expectedModel: 'claude-sonnet-5-5' }));
  const a2 = JSON.stringify(cc.aggregateEvents(events, { expectedModel: 'claude-sonnet-5-5' }));
  assert.equal(a1, a2);
  assert.equal(JSON.stringify(events), before);
});

test('a truncated last line and unknown event types are tolerated', () => {
  const text = `${fs.readFileSync(path.join(FIX, 'vanilla-success.stream.jsonl'), 'utf8')}{"type":"future_thing","x":1}\n{"type":"assis`;
  const { events } = parseStream(text);
  const a = cc.aggregateEvents(events, {});
  assert.equal(a.runFinishedStatus, 'success');
});

// ---- malformed input ----

const typeMutations = (events) => {
  const paths = (o, pre = [], out = []) => {
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push([...pre, k]); paths(o[k], [...pre, k], out); }
    return out;
  };
  const cases = [];
  events.forEach((ev, i) => {
    for (const pth of paths(ev)) {
      for (const v of [null, 0, 'x', [], {}, true]) {
        const copy = JSON.parse(JSON.stringify(events));
        let cur = copy[i];
        for (const k of pth.slice(0, -1)) cur = cur[k];
        cur[pth.at(-1)] = v;
        cases.push({ events: copy, where: `event ${i} ${pth.join('.')} = ${JSON.stringify(v)}` });
      }
    }
  });
  return cases;
};

test('a field of the wrong type anywhere in a recorded stream never makes the parser throw', () => {
  for (const name of ['delegation-dashed-pin', 'vanilla-success', 'permission-denied', 'sigterm']) {
    for (const { events, where } of typeMutations(load(name))) {
      try {
        cc.aggregateEvents(events, { expectedModel: 'claude-sonnet-5-5' });
        cc.spawnTree(events);
        cc.skillCalls(events);
      } catch (e) {
        assert.fail(`${name}: ${where}: ${e.message}`);
      }
    }
  }
});

test('a result line without a usable cost or model usage is flagged as missing cost, with tokens from the assistant messages', () => {
  const events = load('vanilla-success');
  const strip = (mutate) => events.map((ev) => (ev.type === 'result' ? mutate(JSON.parse(JSON.stringify(ev))) : ev));
  const noCost = cc.aggregateEvents(strip((r) => { delete r.total_cost_usd; return r; }), { expectedModel: 'claude-sonnet-5-5' });
  assert.equal(noCost.costMissing, true);
  assert.equal(noCost.costUsd, null);
  const noUsage = cc.aggregateEvents(strip((r) => { r.modelUsage = null; return r; }), { expectedModel: 'claude-sonnet-5-5' });
  assert.equal(noUsage.costMissing, true);
  assert.ok(noUsage.tokens.total > 0, 'falls back to the assistant message sums');
  const fine = agg('vanilla-success');
  assert.equal(fine.costMissing, false);
  assert.equal(agg('model-400').costMissing, false, 'a zero cost and empty modelUsage on an API error are real values');
});

test('canonicalModelOf handles government-cloud prefixes and versioned ids', () => {
  assert.equal(cc.canonicalModelOf('us-gov.anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('eu.anthropic.claude-sonnet-5-5-v1:0'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('anthropic.claude-sonnet-5-5-20260101-v2:0'), 'claude-sonnet-5-5-20260101');
  assert.equal(cc.canonicalModelOf('claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(cc.canonicalModelOf('arn:aws:bedrock:us-east-1::inference-profile/us.anthropic.claude-sonnet-5-5'), 'arn:aws:bedrock:us-east-1::inference-profile/us.anthropic.claude-sonnet-5-5', 'an ARN is left as given');
});
