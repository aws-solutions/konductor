const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function acceptanceText() {
  return fs.readFileSync(path.resolve(process.cwd(), 'docs/ACCEPTANCE.md'), 'utf8');
}

function lineContaining(valuePattern) {
  const line = acceptanceText().split(/\r?\n/).find((candidate) => valuePattern.test(candidate));
  assert.ok(line, `no acceptance-criteria line matched ${valuePattern}`);
  assert.match(
    line,
    /\b(?:is|are|must|shall|should|receives|receive|sees|see|accepted|refused|covers|excludes|requires|remains|writes|can|states|recorded)\b/i,
    `line containing ${valuePattern} should describe an observable outcome: ${line}`,
  );
  return line;
}

const thirtyDays = /(?:30|thirty)(?:\s+|-)(?:calendar(?:\s+|-))?days?/i;
const individualItem = /\b(?:individual|single)\s+item\b/i;
const save10 = /\bSAVE10\b/i;
const fiveHundred = /(?:\$\s*500|500\s*(?:USD|dollars?))/i;
const fifteenMinutes = /(?:15|fifteen)(?:\s+|-)(?:calendar(?:\s+|-))?minutes?/i;
const sevenYears = /(?:7|seven)(?:\s+|-)(?:calendar(?:\s+|-))?years?/i;

test('states the current refund window', () => {
  const text = acceptanceText();
  assert.match(text, thirtyDays);
  assert.doesNotMatch(text, /\b14(?:\s+|-)?days?\b|\bfourteen(?:\s+|-)?days?\b/i);
});

test('makes the refund window an observable rule', () => {
  lineContaining(thirtyDays);
});

test('states that a bundle can be refunded by individual item', () => {
  const text = acceptanceText();
  assert.match(text, individualItem);
  assert.match(text, /allocated\s+bundle\s+price/i);
});

test('makes the bundle partial refund an observable rule', () => {
  lineContaining(individualItem);
});

test('states the coupon behavior for SAVE10', () => {
  const text = acceptanceText();
  assert.match(text, save10);
  assert.match(text, /coupon\s+discount/i);
  assert.match(text, /(?:not|never)\s+(?:restored|reinstated)/i);
});

test('makes the coupon behavior an observable rule', () => {
  lineContaining(save10);
});

test('states the threshold and approving team', () => {
  const text = acceptanceText();
  assert.match(text, fiveHundred);
  assert.match(text, /Finance\s+Operations/i);
});

test('makes high-value approval an observable rule', () => {
  lineContaining(fiveHundred);
});

test('states the decision email timing', () => {
  const text = acceptanceText();
  assert.match(text, fifteenMinutes);
  assert.match(text, /customer\s+receives?\s+an?\s+email/i);
});

test('makes decision email timing an observable rule', () => {
  lineContaining(fifteenMinutes);
});

test('states the audit record retention period', () => {
  const text = acceptanceText();
  assert.match(text, sevenYears);
  assert.match(text, /audit\s+(?:log\s+)?(?:record|entry)/i);
});

test('makes audit retention an observable rule', () => {
  lineContaining(sevenYears);
});
