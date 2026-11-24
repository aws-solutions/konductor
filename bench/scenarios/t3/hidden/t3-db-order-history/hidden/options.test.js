const { readDecision } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');

const R = __dirname + '/..';
const DECISION_FILE = R + '/solution/docs/decision.md';

// two-table-normalized is projected at 2.61 TB (prototype-results.md), over the 2.5 TB hard limit (constraints.txt)
const ACCEPTABLE_OPTIONS = ['composite-optimized'];
const TEMPTING_OPTION = 'single-column-all';

test('chosen option is acceptable', () => {
  const decision = readDecision(DECISION_FILE);
  assert(ACCEPTABLE_OPTIONS.includes(decision.chosen),
    `Chosen option "${decision.chosen}" should be one of: ${ACCEPTABLE_OPTIONS.join(', ')}`);
});

test('chosen option is not the tempting option', () => {
  const decision = readDecision(DECISION_FILE);
  assert(decision.chosen !== TEMPTING_OPTION,
    `Should not choose tempting option "${TEMPTING_OPTION}" which exceeds storage limit`);
});

test('options array includes acceptable options', () => {
  const decision = readDecision(DECISION_FILE);
  // Should include at least one acceptable option
  const hasAcceptable = ACCEPTABLE_OPTIONS.some(opt => decision.options.includes(opt));
  assert(hasAcceptable, `Options should include at least one of: ${ACCEPTABLE_OPTIONS.join(', ')}`);
});

test('tempting option may be in options array (considered but rejected)', () => {
  const decision = readDecision(DECISION_FILE);
  // The tempting option might be in options array (considered but rejected)
  // This is allowed - the important test is that it's not chosen
  if (decision.options.includes(TEMPTING_OPTION)) {
    assert(decision.chosen !== TEMPTING_OPTION,
      'If tempting option is considered, it should not be chosen');
  }
});

test('at least two distinct options considered', () => {
  const decision = readDecision(DECISION_FILE);
  const uniqueOptions = new Set(decision.options);
  assert(uniqueOptions.size >= 2, 'Should consider at least 2 distinct options');
});