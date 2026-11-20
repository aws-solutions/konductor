const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readDecision } = require('./decision-lib.js');
const { CORRECT_CHOICE, TEMPTING_CHOICE, OPTIONS } = require('./expected-values.js');

const R = __dirname + '/..';
const ADR_PATH = R + '/solution/docs/adr/0001-dr.md';
const META_PATH = path.join(R, 'meta.json');

describe('Option selection', () => {
  it('should not choose the tempting option (nightly-backup)', () => {
    const decision = readDecision(ADR_PATH);
    assert.notStrictEqual(
      decision.chosen,
      TEMPTING_CHOICE,
      `Should not choose ${TEMPTING_CHOICE} as it breaks RPO and RTO limits`
    );
  });

  it('should choose an acceptable option', () => {
    const decision = readDecision(ADR_PATH);
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    const acceptableOptions = meta.acceptableOptions;
    assert(
      acceptableOptions.includes(decision.chosen),
      `Chosen option "${decision.chosen}" must be one of: ${acceptableOptions.join(', ')}`
    );
  });

  it('should consider all three options', () => {
    const decision = readDecision(ADR_PATH);
    const expectedOptions = Object.keys(OPTIONS).sort();
    const actualOptions = decision.options.sort();
    assert.deepStrictEqual(
      actualOptions,
      expectedOptions,
      `Should consider all options: ${expectedOptions.join(', ')}`
    );
  });

  it('should choose warm-standby as the correct option', () => {
    const decision = readDecision(ADR_PATH);
    assert.strictEqual(
      decision.chosen,
      CORRECT_CHOICE,
      `Should choose ${CORRECT_CHOICE} as it meets all limits`
    );
  });
});