const test = require('node:test');
const assert = require('node:assert/strict');
const { requirementTexts, blockOf } = require('./doc-key');

test('includes requirements from contract deadline', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  // Contract ends 2025-06-30, need buffer
  const hasContractRequirement = reqs.some(t => 
    /2025.*06.*30|june.*30.*2025|contract.*end|rabbitmq.*contract/i.test(t) &&
    /complete.*before|migration.*by|buffer|before.*end/i.test(t)
  );
  assert.ok(hasContractRequirement, 'Should mention contract end date 2025-06-30 and need to complete before it');
});

test('includes weekend cutover timing', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  // Timezone analysis shows Saturday 02:00-06:00 UTC best
  const hasWeekendTiming = reqs.some(t => 
    /saturday|weekend/i.test(t) &&
    /02:00.*06:00|2.*am.*6.*am|early.*morning.*utc/i.test(t)
  );
  assert.ok(hasWeekendTiming, 'Should specify weekend cutover window (Saturday 02:00-06:00 UTC)');
});

test('includes payment service ordering requirement', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  // Payment team interview shows critical ordering need
  const hasPaymentOrdering = reqs.some(t => 
    /payment.*order|ordering.*payment|fifo.*payment/i.test(t) &&
    /critical|must.*process.*sequence|time.*sensitive/i.test(t)
  );
  assert.ok(hasPaymentOrdering, 'Should specify payment service requires strict message ordering');
});

test('includes communication deadlines', () => {
  const reqs = requirementTexts(blockOf('docs/requirements.md'));
  // Change management requires 2-week customer notice
  const hasCommunicationDeadline = reqs.some(t => 
    /14.*day|two.*week|14-day|2-week/i.test(t) &&
    /customer.*notice|communication.*deadline|notice.*period/i.test(t)
  );
  assert.ok(hasCommunicationDeadline, 'Should specify 14-day customer notification requirement');
});