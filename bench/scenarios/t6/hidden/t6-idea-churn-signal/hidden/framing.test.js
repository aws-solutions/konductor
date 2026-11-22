'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, itemTexts, contradicts } = require('./doc-key.js');

const doc = 'docs/framing.md';
const block = () => blockOf(doc);
const strings = (value) => {
  const out = [];
  const visit = (x) => {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') Object.values(x).forEach(visit);
  };
  visit(block());
  return out.join(' ');
};
const fieldText = (name) => itemTexts(block()[name]).join(' ');

test('writes the requested framing block with the core fields', () => {
  const b = block();
  assert.equal(typeof b.problem, 'string');
  assert.ok(Array.isArray(b.evidence));
  assert.ok(Array.isArray(b.options));
  assert.ok(b.recommendation && typeof b.recommendation === 'object');
  assert.ok(b.success_measure && typeof b.success_measure === 'object');
});

test('frames the main problem as involuntary payment loss without retry', () => {
  const text = `${block().problem || ''} ${block().recommendation?.why || ''}`;
  assert.match(text, /failed\s+(?:card\s+)?payment|payment\s+fail/i);
  assert.match(text, /(?:no|never|without)\s+(?:an?\s+)?(?:automated\s+)?retr(?:y|ied)|retr(?:y|ied)\s+not/i);
  assert.match(text, /involuntary|unpaid\s+invoice/i);
  assert.doesNotMatch(text, /cancel(?:lation)?\s+(?:button|flow)\s+is\s+(?:the\s+)?(?:main|largest|primary)/i);
});

test('states the reconciled June loss total of 612', () => {
  assert.match(fieldText('evidence'), /\b612\b/);
});

test('states 402 failed-payment losses and links them to non-recovery', () => {
  const evidence = fieldText('evidence');
  assert.match(evidence, /\b402\b/);
  assert.match(evidence, /failed|payment/i);
  assert.match(evidence, /no\s+successful\s+payment|without\s+(?:a\s+)?(?:successful\s+)?retr(?:y|ied)|not\s+recover/i);
});

test('states 156 voluntary cancellation losses', () => {
  const evidence = fieldText('evidence');
  assert.match(evidence, /\b156\b/);
  assert.match(evidence, /voluntary|cancel/i);
});

test('states the failed-payment share as about two thirds', () => {
  const evidence = fieldText('evidence');
  assert.match(evidence, /65(?:\.7)?\s*%|66\s*%|two[- ]thirds/i);
});

test('includes the 517 failed card-payment event count', () => {
  assert.match(fieldText('evidence'), /\b517\b/);
});

test('offers at least three distinct options including doing nothing', () => {
  const options = itemTexts(block().options);
  assert.ok(options.length >= 3, `only ${options.length} options`);
  assert.ok(options.some((x) => /do\s+nothing|status\s+quo|no\s+change|defer/i.test(x)));
});

test('options cover payment recovery and a voluntary retention path', () => {
  const options = itemTexts(block().options);
  assert.ok(options.some((x) => /retry|payment\s+(?:recovery|failure)|card\s+update|dunning/i.test(x)));
  assert.ok(options.some((x) => /cancel|pause|save\s+offer|voluntary/i.test(x)));
});

test('recommends fixing payment recovery before a blanket discount', () => {
  const choice = `${block().recommendation?.choice || ''} ${block().recommendation?.why || ''}`;
  assert.match(choice, /retry|payment\s+recover|failed\s+(?:card\s+)?payment|dunning/i);
  assert.doesNotMatch(choice, /blanket\s+discount|discount\s+everyone|give\s+all.*discount/i);
});

test('defines a success measure with a baseline tied to 402 or 65.7 percent', () => {
  const m = block().success_measure || {};
  const text = Object.values(m).filter((x) => typeof x === 'string').join(' ');
  assert.match(text, /baseline/i);
  assert.match(text, /402|65(?:\.7)?\s*%|66\s*%/i);
  assert.match(text, /reduce|below|lower|decrease|target/i);
  assert.match(text, /7\s*day|seven[- ]day/i);
});

test('calls out that the cancellation survey is a selected voluntary-flow sample', () => {
  const text = `${strings()} ${fieldText('caveats')}`;
  assert.match(text, /survey/i);
  assert.match(text, /cancel(?:lation)?[- ]flow|voluntary|select|bias|not\s+.*(?:all|involuntary)/i);
  assert.match(text, /214/);
});

test('calls out the June 10 through 16 cancellation tracking gap', () => {
  const text = `${strings()} ${fieldText('caveats')}`;
  assert.match(text, /June\s+10\s*(?:through|to|[-–])\s*16|10\s*[-–]\s*16/i);
  assert.match(text, /track(?:ing|ed)|event|outage|incomplete|missing/i);
});

test('does not present the survey price count as the overall churn cause', () => {
  const problem = String(block().problem || '');
  assert.ok(problem.trim(), 'the framing block states no problem');
  assert.ok(!contradicts(problem, /(?:price|92).{0,35}(?:main|primary|largest|major\s+cause)/i), 'states the claim (a sentence that denies it is fine)');
});

test('keeps the option set bounded', () => {
  assert.ok(itemTexts(block().options).length >= 1, 'the framing block lists no options');
  assert.ok(itemTexts(block().options).length <= 5, 'too many options make the framing unfocused');
});
