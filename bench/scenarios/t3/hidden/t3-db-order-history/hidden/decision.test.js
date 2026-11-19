const { readDecision } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');

const R = __dirname + '/..';
const DECISION_FILE = R + '/solution/docs/decision.md';

test('decision block exists and is valid JSON', () => {
  const decision = readDecision(DECISION_FILE);
  assert(decision, 'Decision block should exist');
  assert(typeof decision === 'object', 'Decision should be an object');
});

test('decision has required fields', () => {
  const decision = readDecision(DECISION_FILE);
  assert('chosen' in decision, 'Missing "chosen" field');
  assert('options' in decision, 'Missing "options" field');
  assert('limits' in decision, 'Missing "limits" field');
  assert('monthly_cost_usd' in decision, 'Missing "monthly_cost_usd" field');
});

test('chosen is a string', () => {
  const decision = readDecision(DECISION_FILE);
  assert(typeof decision.chosen === 'string', '"chosen" should be a string');
  assert(decision.chosen.length > 0, '"chosen" should not be empty');
});

test('options is an array', () => {
  const decision = readDecision(DECISION_FILE);
  assert(Array.isArray(decision.options), '"options" should be an array');
  assert(decision.options.length >= 2, 'Should consider at least 2 options');
  assert(decision.options.length <= 4, 'Should not consider more than 4 options');
});

test('chosen option is in options array', () => {
  const decision = readDecision(DECISION_FILE);
  assert(decision.options.includes(decision.chosen), 
    `Chosen option "${decision.chosen}" should be in options array [${decision.options}]`);
});

test('limits is an object', () => {
  const decision = readDecision(DECISION_FILE);
  assert(typeof decision.limits === 'object', '"limits" should be an object');
  assert(decision.limits !== null, '"limits" should not be null');
});

test('monthly_cost_usd is a number', () => {
  const decision = readDecision(DECISION_FILE);
  assert(typeof decision.monthly_cost_usd === 'number', '"monthly_cost_usd" should be a number');
  assert(Number.isFinite(decision.monthly_cost_usd), '"monthly_cost_usd" should be finite');
  assert(decision.monthly_cost_usd >= 0, '"monthly_cost_usd" should be non-negative');
});