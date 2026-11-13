// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTools } = require('../lib/tool-names.js');

const TOOLS = ['lookup_order', 'check_refund_policy', 'issue_refund', 'send_email', 'escalate_to_human'];
const run = (trajectory) => extractTools(trajectory, TOOLS);

test('call strings with positional or keyword args are clean', () => {
  const r = run(['lookup_order(ORD-1)', "check_refund_policy(order_id='ORD-1')", 'issue_refund("ORD-1", 5.0, "late")', 'send_email']);
  assert.deepEqual(r.tools, ['lookup_order', 'check_refund_policy', 'issue_refund', 'send_email']);
  assert.equal(r.quality, 'clean');
  assert.deepEqual(r.undeclared, []);
});

test('a call string may span lines', () => {
  const r = run(["send_email(to='a@b.c', body='Hello,\n\nthanks')"]);
  assert.deepEqual(r.tools, ['send_email']);
  assert.equal(r.quality, 'clean');
});

test('dicts keyed by tool, tool_name, name, function, action or step are extracted', () => {
  for (const key of ['tool', 'tool_name', 'name', 'function', 'action', 'step']) {
    const r = run([{ [key]: 'lookup_order', parameters: { order_id: 'X' } }]);
    assert.deepEqual(r.tools, ['lookup_order'], key);
    assert.equal(r.quality, 'extracted', key);
  }
});

test('a dict value may be a name(args) string, and a numeric step is skipped', () => {
  const r = run([{ step: 1, action: "lookup_order(order_id='ORD-9')", purpose: 'x' }, { function: { name: 'issue_refund', arguments: {} } }]);
  assert.deepEqual(r.tools, ['lookup_order', 'issue_refund']);
});

test('two-element lists give the first element as the tool and flag an undeclared second name', () => {
  const r = run([['lookup_order', 'order_id=ORD-789'], ['send_email', { to: 'x' }], ['issue_refund', 'process_partial_refund']]);
  assert.deepEqual(r.tools, ['lookup_order', 'send_email', 'issue_refund']);
  assert.deepEqual(r.undeclared, ['process_partial_refund']);
  assert.equal(r.quality, 'extracted');
});

test('prose steps recover declared names on word boundaries', () => {
  const r = run(['Agent must first look up order ORD-123 using lookup_order tool.', 'Agent should use escalate_to_human tool with a summary.']);
  assert.deepEqual(r.tools, ['lookup_order', 'escalate_to_human']);
  assert.equal(r.quality, 'extracted');
});

test('a longer name does not match inside a different identifier', () => {
  const r = run(['call my_lookup_order_v2 now', 'lookup_orders are fine']);
  assert.deepEqual(r.tools, []);
  assert.equal(r.quality, 'none');
});

test('a negated mention is not a tool and is noted', () => {
  const r = run(['The agent must NOT call issue_refund here', 'lookup_order for ORD-4']);
  assert.deepEqual(r.tools, ['lookup_order']);
  assert.ok(r.notes.some((n) => /negated mention of issue_refund/.test(n)));
});

test('tool_response steps are ignored, even when they carry a tool key', () => {
  const r = run([
    { type: 'tool_usage', tool: 'lookup_order', args: { order_id: 'A' } },
    { type: 'tool_response', tool: 'lookup_order', data: { status: 'delivered' } },
    { tool_response: 'Order status: shipped' },
    { type: 'tool_result', tool: 'check_refund_policy', data: {} },
  ]);
  assert.deepEqual(r.tools, ['lookup_order']);
  assert.equal(r.quality, 'extracted');
  assert.ok(r.notes.some((n) => /3 tool response steps ignored/.test(n)));
});

test('generator chatter is ignored and does not contribute names', () => {
  const r = run(['Here are a few test cases using lookup_order:', 'expected_output: the agent calls issue_refund', 'Good. Let us go on.', 'send_email(to=a)']);
  assert.deepEqual(r.tools, ['send_email']);
  assert.ok(r.notes.some((n) => /chatter/.test(n)));
  assert.equal(r.quality, 'extracted');
});

test('undeclared calls are listed, snake_case values of tool-name keys too, but plain words are not', () => {
  const r = run(['search_order_info(ORD-1)', 'lookup_order(ORD-1)', { function: 'check_order_status' }, { action: 'response', content: 'hi' }, { action: 'ask_for_order_id' }, 'inform the customer (politely)']);
  assert.deepEqual(r.tools, ['lookup_order']);
  assert.deepEqual(r.undeclared, ['search_order_info', 'check_order_status']);
  assert.equal(r.quality, 'extracted');
});

test('a name found only in a sibling text field of a dict is recovered', () => {
  const r = run([{ step: 1, action: 'Agent looks up order', expected: 'lookup_order shows multiple items' }]);
  assert.deepEqual(r.tools, ['lookup_order']);
  assert.equal(r.quality, 'extracted');
});

test('a name key wins over names in sibling description text', () => {
  const r = run([{ tool: 'lookup_order', description: 'then check_refund_policy and issue_refund' }]);
  assert.deepEqual(r.tools, ['lookup_order']);
});

test('null, empty and unreadable trajectories report quality none', () => {
  assert.deepEqual(run(null), { tools: [], quality: 'none', undeclared: [], notes: ['empty trajectory'], steps: 0 });
  assert.equal(run([]).quality, 'none');
  const prose = run(['Ask the customer for the order id', 'Offer alternatives']);
  assert.equal(prose.quality, 'none');
  assert.equal(prose.steps, 2);
});

test('a lone string or object trajectory is treated as one step', () => {
  assert.deepEqual(run('lookup_order(ORD-1)').tools, ['lookup_order']);
  assert.deepEqual(run({ tool: 'send_email' }).tools, ['send_email']);
});

test('repeated calls keep their order and count', () => {
  assert.deepEqual(run(['lookup_order(A)', 'lookup_order(B)']).tools, ['lookup_order', 'lookup_order']);
});

test('an undeclared call alone gives quality none', () => {
  const r = run(['search_order_info(x)']);
  assert.equal(r.quality, 'none');
  assert.deepEqual(r.undeclared, ['search_order_info']);
});

test('declaredTools must be a non-empty list of names', () => {
  assert.throws(() => extractTools([], []), /declaredTools/);
  assert.throws(() => extractTools([], ['ok', 3]), /declaredTools/);
  assert.throws(() => extractTools([], undefined), /declaredTools/);
});
