// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadExperiment, parseExperiment } = require('../lib/experiment.js');
const { loadRules } = require('../lib/rules.js');
const { buildCandidates } = require('../lib/candidates.js');

const TOOLS = ['lookup_order', 'check_refund_policy', 'issue_refund', 'send_email', 'escalate_to_human'];
const FIXTURES = path.join(__dirname, 'fixtures');
const make = (cases, evaluators = []) => parseExperiment({ cases, evaluators });
const one = (c, opts = {}) => buildCandidates(make([c]), { tools: TOOLS, ...opts }).candidates[0];

const GOOD = { name: 'Refund Status', session_id: 'sid-1', input: 'I want to return my order #ORD-55555, it arrived broken.', expected_output: 'Done.', expected_trajectory: ['lookup_order(ORD-55555)', 'check_refund_policy(ORD-55555)'], metadata: { difficulty: 'easy' } };

test('a clean case with a real input is ok and carries its provenance', () => {
  const c = one(GOOD, { source: { version: '1.9.0', model: 'm', contextSha256: 'abc', taskDescription: 'Customer service' } });
  assert.equal(c.status, 'ok');
  assert.deepEqual(c.reasons, []);
  assert.equal(c.id, 'refund-status-0');
  assert.deepEqual(c.proposedTools, ['lookup_order', 'check_refund_policy']);
  assert.equal(c.trajectoryQuality, 'clean');
  assert.deepEqual(c.generatorMetadata, { difficulty: 'easy' });
  assert.deepEqual(c.generatorTrajectory, GOOD.expected_trajectory);
  assert.deepEqual(c.source, { version: '1.9.0', model: 'm', contextSha256: 'abc', taskDescription: 'Customer service', generator: 'strands-evals', sourceFile: null, caseIndex: 0, sessionId: 'sid-1' });
  assert.equal('batchIndex' in c, false);
  assert.equal('rawInput' in c, false);
});

test('ids come from the name slug and the index, so they stay stable and unique', () => {
  const exp = make([{ ...GOOD, name: 'Same Name' }, { ...GOOD, name: 'Same Name', input: 'a different order question about #ORD-2 please' }, { ...GOOD, name: '' }, { ...GOOD, name: '!!!' }]);
  const ids = buildCandidates(exp, { tools: TOOLS }).candidates.map((c) => c.id);
  assert.deepEqual(ids, ['same-name-0', 'same-name-1', 'case-2', 'case-3']);
  assert.deepEqual(buildCandidates(exp, { tools: TOOLS }).candidates.map((c) => c.id), ids);
});

test('a normalized input keeps the raw text and sets inputNormalized', () => {
  const c = one({ ...GOOD, input: 'Customer: "I want to return my order #ORD-55555, it arrived broken."' });
  assert.equal(c.input, 'I want to return my order #ORD-55555, it arrived broken.');
  assert.equal(c.inputNormalized, true);
  assert.equal(c.rawInput, 'Customer: "I want to return my order #ORD-55555, it arrived broken."');
  assert.equal(c.status, 'ok');
});

test('invalid input and duplicates are rejected, and the original of a duplicate stays', () => {
  const exp = make([GOOD, { ...GOOD, name: 'again', input: 'i want to return my order #ORD-55555 it arrived broken' }, { ...GOOD, name: 'bad', input: 'string' }]);
  const { candidates, summary } = buildCandidates(exp, { tools: TOOLS });
  assert.deepEqual(candidates.map((c) => c.status), ['ok', 'reject', 'reject']);
  assert.equal(candidates[1].duplicateOf, 'refund-status-0');
  assert.deepEqual(candidates[1].reasons.map((r) => r.code), ['duplicate']);
  assert.deepEqual(candidates[2].reasons.map((r) => r.code), ['input:placeholder']);
  assert.equal(candidates[2].duplicateOf, null);
  assert.deepEqual(summary.byStatus, { ok: 1, 'needs-edit': 0, reject: 2 });
});

test('a rejected input gets no rule checks, since the rules read the input', () => {
  const rules = [{ tool: 'send_email', inputPattern: 'mail' }];
  const c = one({ ...GOOD, input: 'string', expected_trajectory: ['send_email(x)'] }, { rules });
  assert.deepEqual(c.reasons.map((r) => r.code), ['input:placeholder']);
});

test('needs-edit reasons: unreadable trajectory, undeclared tool, placeholder output, rule violation, multi-turn', () => {
  assert.deepEqual(one({ ...GOOD, expected_trajectory: ['Ask for the order id', 'Offer help'] }).reasons.map((r) => r.code), ['trajectory:unreadable']);
  assert.deepEqual(one({ ...GOOD, expected_trajectory: [['lookup_order', 'search_order_info']] }).reasons.map((r) => r.code), ['trajectory:not-clean', 'tool:undeclared']);
  assert.deepEqual(one({ ...GOOD, expected_output: 'Your order is [status].' }).reasons.map((r) => r.code), ['output:placeholder']);
  assert.deepEqual(one({ ...GOOD, input: 'Customer: Hi there.\nCustomer: My order #ORD-5 is late.' }).reasons.map((r) => r.code), ['input:multi-turn']);
  const rules = [{ before: ['lookup_order', 'issue_refund'] }];
  const c = one({ ...GOOD, expected_trajectory: ['issue_refund(ORD-1, 5)'] }, { rules });
  assert.equal(c.status, 'needs-edit');
  assert.deepEqual(c.reasons.map((r) => r.code), ['rule:before']);
});

test('an empty or missing trajectory is a valid no-tool case and stays ok', () => {
  for (const traj of [[], null]) {
    const c = one({ ...GOOD, expected_trajectory: traj });
    assert.equal(c.status, 'ok');
    assert.equal(c.trajectoryQuality, 'none');
    assert.deepEqual(c.proposedTools, []);
  }
});

test('batches label cases by position and mark the label as inferred', () => {
  const cases = Array.from({ length: 6 }, (_, i) => ({ ...GOOD, name: `c${i}`, input: `question number ${i} about unique topic ${'x'.repeat(i + 1)} zeta${i}` }));
  const out = buildCandidates(make(cases), { tools: TOOLS, batches: 3 }).candidates;
  assert.deepEqual(out.map((c) => c.batchIndex), [0, 0, 1, 1, 2, 2]);
  assert.ok(out.every((c) => c.batchInferred === true));
  const uneven = buildCandidates(make(cases.slice(0, 5)), { tools: TOOLS, batches: 2 }).candidates.map((c) => c.batchIndex);
  assert.deepEqual(uneven, [0, 0, 0, 1, 1]);
  assert.throws(() => buildCandidates(make(cases), { tools: TOOLS, batches: 0 }), /batches/);
});

test('rubricHint joins the experiment rubrics as one string and is never split', () => {
  const exp = make([GOOD], [{ evaluator_type: 'T', rubric: ' First rubric. ' }, { evaluator_type: 'O', rubric: 'Second rubric.' }, { evaluator_type: 'X' }]);
  assert.equal(buildCandidates(exp, { tools: TOOLS }).rubricHint, 'First rubric.\n\nSecond rubric.');
  assert.equal(buildCandidates(make([GOOD]), { tools: TOOLS }).rubricHint, null);
});

test('non-string expected output is kept as opaque text', () => {
  assert.equal(one({ ...GOOD, expected_output: { a: 1 } }).expectedOutputText, '{"a":1}');
  assert.equal(one({ ...GOOD, expected_output: null }).expectedOutputText, null);
});

test('raw rule objects are parsed against the declared tools, and bad ones fail loudly', () => {
  assert.equal(one(GOOD, { rules: [{ before: ['lookup_order', 'issue_refund'] }] }).status, 'ok');
  assert.throws(() => one(GOOD, { rules: [{ before: ['lookup_order', 'nope'] }] }), /not a declared tool/);
});

// Expected counts for the 14-case sample, derived by hand from the fixture (index: reasons):
//  0 custom_item_non_refundable     clean strings, order id present                         ok
//  1 Verbal abuse ...               dict steps (function key), two Customer: turns          needs-edit  multi-turn, not-clean
//  2 check_refund_eligibility       tool_response dicts ignored                             needs-edit  not-clean
//  3 simple_order_status_check      [name, args] lists, send_email never asked for          needs-edit  not-clean, forbidUnless
//  4 Refund inquiry ... damaged     lists with search_order_info and 3 more, unasked email  needs-edit  not-clean, undeclared, forbidUnless
//  5 Amount Creep ...               prose trajectory, <tool call> and ... in the output     needs-edit  not-clean, output placeholder
//  6 Mixed_Complex_Scenario ...     generator chatter and prose, no tool name               needs-edit  unreadable
//  7 Order Inquiry Without Order ID empty trajectory, no tool needed                        ok
//  8 Order Status Inquiry - Easy    no trajectory (OutputEvaluator run), label and quotes   ok  (input normalized)
//  9 medium_multi_item ...          input is the word string, output is string              reject  input placeholder (+ not-clean, output placeholder)
// 10 _Customer Service Assistant    input is a title                                        reject  title-like
// 11 basic_order_status_inquiry     near-duplicate of 3, [status] slots in the output       reject  duplicate (+ not-clean, output placeholder)
// 12 a03d327f                       lookup named in prose, no order id in the input         needs-edit  not-clean, forbidUnless
// 13 Missing Order ID ...           three Customer: turns, [After receiving ...] in output  needs-edit  multi-turn, not-clean, output placeholder
test('end to end on the 14-case sample', () => {
  const tools = TOOLS;
  const exp = loadExperiment(path.join(FIXTURES, 'strands-sample.json'));
  const rules = loadRules(path.join(FIXTURES, 'rules.json'), { tools });
  const { candidates, summary, rubricHint } = buildCandidates(exp, { tools, rules, batches: 2, source: { taskDescription: 'Customer service assistant', model: 'deepseek.v3.2' } });

  assert.deepEqual(candidates.map((c) => c.status), ['ok', 'needs-edit', 'needs-edit', 'needs-edit', 'needs-edit', 'needs-edit', 'needs-edit', 'ok', 'ok', 'reject', 'reject', 'reject', 'needs-edit', 'needs-edit']);
  assert.deepEqual(summary.byStatus, { ok: 3, 'needs-edit': 8, reject: 3 });
  assert.deepEqual(summary.byReason, {
    'input:multi-turn': 2,
    'trajectory:not-clean': 9,
    'trajectory:unreadable': 1,
    'tool:undeclared': 1,
    'output:placeholder': 4,
    'rule:forbidUnless': 3,
    'input:placeholder': 1,
    'input:title-like': 1,
    duplicate: 1,
  });
  assert.deepEqual(summary.byQuality, { clean: 1, extracted: 9, none: 4 });
  assert.equal(summary.total, 14);

  const by = (i) => candidates[i];
  assert.deepEqual(by(4).undeclaredTools, ['search_order_info', 'check_refund_eligibility', 'process_partial_refund', 'notify_customer_refund_confirmation']);
  assert.equal(by(11).duplicateOf, by(3).id);
  assert.equal(by(8).inputNormalized, true);
  assert.equal(by(8).input, 'Hi, can you tell me the status of my order?');
  assert.equal(by(1).multiTurn, true);
  assert.equal(by(13).multiTurn, true);
  assert.equal(by(5).placeholderOutput, true);
  assert.deepEqual(by(12).reasons.map((r) => r.code), ['trajectory:not-clean', 'rule:forbidUnless']);
  assert.match(by(12).reasons[1].text, /lookup_order is proposed but the input does not match/);
  assert.deepEqual(candidates.map((c) => c.batchIndex), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(by(0).source.sourceFile, path.join(FIXTURES, 'strands-sample.json'));
  assert.equal(by(0).source.model, 'deepseek.v3.2');
  assert.ok(rubricHint.startsWith('Scoring should consider whether the agent correctly uses the lookup_order tool'));
  assert.equal(new Set(candidates.map((c) => c.id)).size, 14);
});
