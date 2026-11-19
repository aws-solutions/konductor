'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, itemTexts, requirementTexts } = require('./doc-key');

const block = () => blockOf('docs/framing.md');
const allText = () => JSON.stringify(block());
const issueText = () => itemTexts(block().issues).join(' ');
const closeRate = (value, target) => Math.abs(Number(value) - target) <= 0.001 || Math.abs(Number(value) - target * 100) <= 0.1;

test('writes the requested structured framing block', () => {
  const b = block();
  assert.equal(typeof b.decision, 'string');
  assert.ok(Array.isArray(b.issues));
  assert.ok(Array.isArray(b.options));
  assert.equal(typeof b.adjusted_result, 'object');
  assert.equal(b.corrected_effect_range, undefined);
  assert.deepEqual(Object.keys(b.adjusted_result).sort(), ['basis', 'high_pp', 'low_pp', 'metric']);
  assert.equal(typeof b.next_step, 'object');
});

test('decision does not approve an immediate rollout', () => {
  const d = block().decision;
  assert.match(d, /do not|hold|pause|defer|wait|rerun|repeat/i);
  assert.doesNotMatch(d, /roll out|publish|ship|launch/i);
});

test('finds the three distinct data problems', () => {
  const t = issueText();
  assert.match(t, /assign|split|ratio|50.?50/i);
  assert.match(t, /campaign|promotion|spring skills|email/i);
  assert.match(t, /refund/i);
  assert.ok(block().issues.length <= 4, 'issue list should stay focused');
});

test('reports the assignment counts and share mismatch', () => {
  const t = issueText();
  assert.match(t, /5,?584/);
  assert.match(t, /5,?256/);
  assert.match(t, /48\.4[0-9]?|48\.5/);
  assert.match(t, /51\.5[0-9]?|51\.6/);
  assert.match(t, /50/);
});

test('ties the confound to the 15 through 18 April campaign', () => {
  const t = issueText();
  assert.match(t, /15.{0,5}18\s*April/i);
  assert.match(t, /Spring Skills Credit/i);
  assert.match(t, /4,?860/);
  assert.match(t, /Variant B|B/);
  assert.match(t, /campaign.?id|campaign id/i);
});

test('shows the asymmetric refund evidence', () => {
  const t = issueText();
  assert.match(t, /22/);
  assert.match(t, /58/);
  assert.match(t, /5\.7[0-9]?|5\.8/);
  assert.match(t, /14\.1[0-9]?|14\.2/);
  assert.match(t, /359/);
  assert.match(t, /351/);
});

test('preserves the gross result before correcting it', () => {
  const b = block();
  const t = allText();
  assert.equal(b.raw_result.control.paid, 381);
  assert.equal(b.raw_result.variant_b.paid, 409);
  assert.match(t, /0\.068[0-9]?|6\.8[0-9]?/);
  assert.match(t, /0\.077[0-9]?|7\.8[0-9]?/);
  assert.match(t, /0\.9[0-9]?|1(?:\.0)?/);
});

test('gives the all-day adjusted comparison', () => {
  const s = block().adjusted_result.basis;
  assert.match(s, /359/);
  assert.match(s, /5,?584/);
  assert.match(s, /351/);
  assert.match(s, /5,?256/);
  assert.match(s, /6\.4[0-9]?|0\.064[0-9]?/);
  assert.match(s, /6\.6[0-9]?|0\.066[0-9]?/);
  assert.match(s, /\+?0\.3/);
});

test('gives the comparison with the overlapping dates removed', () => {
  const s = block().adjusted_result.basis;
  assert.match(s, /264/);
  assert.match(s, /4,?054/);
  assert.match(s, /228/);
  assert.match(s, /3,?816/);
  assert.match(s, /6\.5[0-9]?|0\.065[0-9]?/);
  assert.match(s, /5\.9[0-9]?|0\.059[0-9]?/);
  assert.match(s, /-0\.5/);
});

test('states the adjusted result range', () => {
  const r = block().adjusted_result;
  assert.ok(r.low_pp <= -0.45 && r.low_pp >= -0.6);
  assert.ok(r.high_pp >= 0.25 && r.high_pp <= 0.4);
  assert.match(`${r.metric} ${r.basis}`, /retained|refund/i);
  assert.match(r.basis, /-?0\.5/);
  assert.match(r.basis, /\+?0\.3/);
});

test('compares rollout choices and selects a clean repeat', () => {
  const t = JSON.stringify(block().options);
  assert.ok(block().options.length >= 3);
  assert.match(t, /roll out|publish|now/i);
  assert.match(t, /rerun|repeat|clean/i);
  assert.match(t, /choose|reject|keep Control/i);
});

test('next step names the measure and its baseline', () => {
  const n = block().next_step;
  assert.match(n.action, /Control/i);
  assert.match(n.action, /50.?50|balanced/i);
  assert.match(n.action, /campaign|promotion/i);
  assert.match(n.action, /seven.?day|7.?day/i);
  assert.match(n.measure, /retained paid conversion/i);
  assert.ok(closeRate(n.baseline.control_rate, 0.0643));
  assert.ok(closeRate(n.baseline.variant_b_rate, 0.0668));
});

test('does not claim the campaign caused the assignment mismatch', () => {
  const t = issueText();
  assert.doesNotMatch(t, /campaign.{0,60}(caused|created|produced).{0,60}(assign|ratio|split)/i);
  assert.doesNotMatch(t, /refund.{0,60}(caused|created|produced).{0,60}(assign|ratio|split)/i);
});
