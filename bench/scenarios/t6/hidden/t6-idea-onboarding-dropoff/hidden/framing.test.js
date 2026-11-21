'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, itemTexts, contradicts } = require('./doc-key');

const doc = 'docs/framing.md';
const block = () => blockOf(doc);
const allText = () => JSON.stringify(block()).toLowerCase();
const evidence = () => itemTexts(block().evidence).map((t) => t.toLowerCase());
const options = () => itemTexts(block().options).map((t) => t.toLowerCase());
// A date in any common spelling: "21 January", "January 21", "Jan 21" or "2025-01-21".
const onDate = (day, month, mm) => new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\s*${month}|${month}[a-z]*\\.?\\s*0?${day}\\b|-${mm}-0?${day}\\b`);

// Each test checks one decision-relevant fact while allowing ordinary wording changes.
test('identifies verification as the main problem and names the affected provider', () => {
  const t = String(block().main_problem || '').toLowerCase();
  assert.match(t, /email|mail/);
  assert.match(t, /verif/);
  assert.match(t, /cloudmail/);
});

test('shows the approximately 84 percent pre-change verification baseline', () => {
  assert.ok(evidence().some((t) => /84(?:\.0)?\s*%/.test(t) && /8[,.]?232/.test(t) && /9[,.]?800/.test(t)), 'baseline evidence is missing');
});

test('shows the post-change verification rate near 54 percent', () => {
  assert.ok(evidence().some((t) => /(?:53(?:\.6)?|54(?:\.0)?)\s*%/.test(t) && /5[,.]?740/.test(t) && /10[,.]?700/.test(t)), 'post-change verification evidence is missing');
});

test('shows Cloudmail delivery at 77 percent and bounce rate at 23 percent after cutover', () => {
  assert.ok(evidence().some((t) => /cloudmail/.test(t) && /77(?:\.0)?\s*%/.test(t) && /23(?:\.0)?\s*%/.test(t)), 'provider delivery and bounce rates are missing');
});

test('shows that Cloudmail is about 64 percent of post-cutover sends', () => {
  assert.ok(evidence().some((t) => /cloudmail/.test(t) && /64(?:\.0)?\s*%/.test(t) && /30[,.]?700/.test(t) && /48[,.]?000/.test(t)), 'provider concentration evidence is missing');
});

test('separates the 3 February tracking outage from the behavioral result', () => {
  assert.ok(evidence().some((t) => onDate(3, 'feb', '02').test(t) && /3[,.]?020/.test(t) && /5[,.]?605/.test(t) && /(track|analytic|event|instrument)/.test(t) && /(backend|reconcil|not evidence|not a comparable|measurement)/.test(t)), 'reconciled outage evidence is missing');
});

test('connects the fall to the 21 January sending-domain change without claiming a UI release', () => {
  assert.ok(evidence().some((t) => onDate(21, 'jan', '01').test(t) && /domain/.test(t)), 'domain-change timing is missing');
});

test('offers a targeted email or provider remediation option', () => {
  assert.ok(options().some((t) => /(email|mail|provider|domain|delivery)/.test(t) && /(fix|repair|restore|roll back|authenticate|warm|monitor|trace)/.test(t)), 'targeted remediation option is missing');
});

test('offers a bounded onboarding or verification experience option', () => {
  assert.ok(options().some((t) => /(onboarding|screen|resend|inbox|copy|ui|experience|experiment)/.test(t) && /(test|experiment|change|add|improv|assist|guide)/.test(t)), 'product experience option is missing');
});

test('includes an explicit do-nothing or hold option', () => {
  assert.ok(options().some((t) => /(do nothing|no change|leave .* unchanged|hold|defer|wait)/.test(t)), 'no-change option is missing');
});

test('recommends fixing delivery and validating the cause before redesigning screens', () => {
  const t = String(block().recommendation || '').toLowerCase();
  assert.match(t, /(email|mail|provider|domain|delivery)/);
  assert.match(t, /(first|before|priorit|repair|fix|validate|investigat)/);
  assert.match(t, /(redesign|screen|ui)/);
  assert.doesNotMatch(t, /redesign onboarding first|start with a redesign/);
});

test('defines a backend verification measure with the 84 percent baseline', () => {
  const m = block().success_measure || {};
  const t = JSON.stringify(m).toLowerCase();
  assert.match(t, /verif/);
  assert.match(t, /(backend|identity)/);
  assert.match(t, /84(?:\.0)?\s*%/);
  assert.match(t, /(baseline|before|jan)/);
});

test('does not call the analytics outage the cause and keeps the option list bounded', () => {
  const t = `${String(block().main_problem || '')} ${String(block().recommendation || '')}`.toLowerCase();
  assert.ok(!contradicts(t, /(tracking|analytics|instrumentation).{0,50}(caused|cause|root cause)/), 'states the claim (a sentence that denies it is fine)');
  assert.ok(options().length >= 3 && options().length <= 5, `expected 3 to 5 options, got ${options().length}`);
});
