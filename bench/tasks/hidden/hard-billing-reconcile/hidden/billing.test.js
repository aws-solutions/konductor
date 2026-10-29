'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTrial, refundFor, prorateCredit, planChangeCharge, cancelSubscription, seatLimit, seatOverage, quote, graceDeadline } = require('../src');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2025, 5, 1, 12, 0, 0);

test('a trial lasts 7 days', () => {
  for (const plan of ['starter', 'team', 'enterprise']) assert.equal(startTrial({ plan, startedAt: T0 }).trialEndsAt, T0 + 7 * DAY, plan);
  assert.throws(() => startTrial({ plan: 'team', startedAt: 'now' }), TypeError);
});

test('the refund window is 30 days, inclusive', () => {
  const pay = { amountCents: 2900, paidAt: T0 };
  assert.deepEqual(refundFor(pay, T0), { eligible: true, amountCents: 2900 });
  assert.deepEqual(refundFor(pay, T0 + 14 * DAY + 1), { eligible: true, amountCents: 2900 });
  assert.deepEqual(refundFor(pay, T0 + 29 * DAY), { eligible: true, amountCents: 2900 });
  assert.deepEqual(refundFor(pay, T0 + 30 * DAY), { eligible: true, amountCents: 2900 });
});

test('after 30 days there is no refund', () => {
  const pay = { amountCents: 2900, paidAt: T0 };
  assert.deepEqual(refundFor(pay, T0 + 30 * DAY + 1), { eligible: false, amountCents: 0 });
  assert.deepEqual(refundFor(pay, T0 + 90 * DAY), { eligible: false, amountCents: 0 });
});

test('a refund requested before the payment is a RangeError', () => {
  assert.throws(() => refundFor({ amountCents: 1, paidAt: T0 }, T0 - 1), RangeError);
});

test('proration rounds half up', () => {
  for (const [amount, used, period, want] of [[5, 1, 2, 3], [1001, 1, 2, 501], [1003, 1, 2, 502], [7, 1, 2, 4], [9, 1, 2, 5], [1, 1, 2, 1], [13, 3, 6, 7], [25, 1, 2, 13]]) {
    assert.equal(prorateCredit({ amountCents: amount, daysUsed: used, daysInPeriod: period }), want, `${amount} ${used}/${period}`);
  }
});

test('proration away from ties is plain rounding', () => {
  assert.equal(prorateCredit({ amountCents: 1000, daysUsed: 2, daysInPeriod: 3 }), 333);
  assert.equal(prorateCredit({ amountCents: 1000, daysUsed: 1, daysInPeriod: 3 }), 667);
  assert.equal(prorateCredit({ amountCents: 2900, daysUsed: 0, daysInPeriod: 31 }), 2900);
  assert.equal(prorateCredit({ amountCents: 2900, daysUsed: 31, daysInPeriod: 31 }), 0);
});

test('proration rejects days that do not fit the period', () => {
  for (const [daysUsed, daysInPeriod] of [[-1, 30], [31, 30], [1.5, 30], [1, 0], [1, 30.5]]) {
    assert.throws(() => prorateCredit({ amountCents: 100, daysUsed, daysInPeriod }), RangeError, `${daysUsed}/${daysInPeriod}`);
  }
});

test('a plan change uses the same rounding as proration', () => {
  assert.equal(planChangeCharge({ fromCents: 900, toCents: 2900, daysUsed: 15, daysInPeriod: 30 }), 1000);
  assert.equal(planChangeCharge({ fromCents: 1001, toCents: 2003, daysUsed: 1, daysInPeriod: 2 }), 501);
});

test('a plan change equals the prorated new plan minus the prorated old plan', () => {
  for (let from = 1; from <= 30; from += 3) {
    for (let to = 1; to <= 40; to += 5) {
      for (let period = 1; period <= 7; period++) {
        for (let used = 0; used <= period; used++) {
          const want = prorateCredit({ amountCents: to, daysUsed: used, daysInPeriod: period }) - prorateCredit({ amountCents: from, daysUsed: used, daysInPeriod: period });
          assert.equal(planChangeCharge({ fromCents: from, toCents: to, daysUsed: used, daysInPeriod: period }), want, `${from} ${to} ${used}/${period}`);
        }
      }
    }
  }
});

test('the team plan has 10 seats', () => {
  assert.equal(seatLimit('team'), 10);
  assert.equal(seatLimit('starter'), 1);
  assert.equal(seatLimit('enterprise'), null);
  assert.throws(() => seatLimit('gold'), RangeError);
});

test('cancelling takes effect at once and credits the unused part, prorated half up', () => {
  const base = { amountCents: 2900, daysUsed: 10, daysInPeriod: 30, requestedAt: T0, periodEnd: T0 + 20 * DAY };
  assert.deepEqual(cancelSubscription(base), { effectiveAt: T0, creditCents: 1933 });
  assert.deepEqual(cancelSubscription({ ...base, amountCents: 5, daysUsed: 1, daysInPeriod: 2 }), { effectiveAt: T0, creditCents: 3 });
});

test('cancelling on the last day credits nothing and on the first day credits everything', () => {
  const base = { amountCents: 900, daysInPeriod: 30, requestedAt: T0, periodEnd: T0 + 30 * DAY };
  assert.equal(cancelSubscription({ ...base, daysUsed: 30 }).creditCents, 0);
  assert.equal(cancelSubscription({ ...base, daysUsed: 0 }).creditCents, 900);
  assert.throws(() => cancelSubscription({ ...base, daysUsed: 31 }), RangeError);
});

test('extra seats cost 450 cents each', () => {
  assert.equal(seatOverage({ plan: 'team', seats: 12 }), 900);
  assert.equal(seatOverage({ plan: 'team', seats: 10 }), 0);
  assert.equal(seatOverage({ plan: 'team', seats: 0 }), 0);
  assert.equal(seatOverage({ plan: 'starter', seats: 4 }), 1350);
  assert.equal(seatOverage({ plan: 'enterprise', seats: 500 }), 0);
  assert.throws(() => seatOverage({ plan: 'team', seats: -1 }), RangeError);
  assert.throws(() => seatOverage({ plan: 'gold', seats: 1 }), RangeError);
});

test('EU prices include tax', () => {
  assert.deepEqual(quote({ plan: 'starter', customer: { region: 'EU' } }), { totalCents: 900, taxCents: 150 });
  assert.deepEqual(quote({ plan: 'team', customer: { region: 'EU' } }), { totalCents: 2900, taxCents: 483 });
  assert.deepEqual(quote({ plan: 'enterprise', billing: 'monthly', customer: { region: 'EU' } }), { totalCents: 9900, taxCents: 1650 });
});

test('customers outside the EU pay the list price without tax', () => {
  for (const customer of [{ region: 'US' }, { region: 'UK' }, {}, undefined]) assert.deepEqual(quote({ plan: 'team', customer }), { totalCents: 2900, taxCents: 0 });
});

test('the annual discount is 20% off twelve months', () => {
  assert.deepEqual(quote({ plan: 'starter', billing: 'annual' }), { totalCents: 8640, taxCents: 0 });
  assert.deepEqual(quote({ plan: 'team', billing: 'annual' }), { totalCents: 27840, taxCents: 0 });
  assert.deepEqual(quote({ plan: 'enterprise', billing: 'annual' }), { totalCents: 95040, taxCents: 0 });
});

test('annual EU quotes combine the discount with included tax', () => {
  assert.deepEqual(quote({ plan: 'starter', billing: 'annual', customer: { region: 'EU' } }), { totalCents: 8640, taxCents: 1440 });
  assert.deepEqual(quote({ plan: 'team', billing: 'annual', customer: { region: 'EU' } }), { totalCents: 27840, taxCents: 4640 });
  assert.deepEqual(quote({ plan: 'enterprise', billing: 'annual', customer: { region: 'EU' } }), { totalCents: 95040, taxCents: 15840 });
});

test('quote input errors', () => {
  assert.throws(() => quote({ plan: 'gold' }), RangeError);
  assert.throws(() => quote({ plan: 'team', billing: 'weekly' }), RangeError);
});

test('the grace period is 5 days', () => {
  assert.equal(graceDeadline(T0), T0 + 5 * DAY);
});

function table(file) {
  const rows = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', 'docs', file), 'utf8').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (/^R\d+$/.test(cells[1] || '')) rows[cells[1]] = cells[3];
  }
  return rows;
}

test('both documents state the same value for every rule', () => {
  const a = table('REQUIREMENTS.md');
  const b = table('API.md');
  assert.deepEqual(Object.keys(a), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10']);
  assert.deepEqual(Object.keys(b), Object.keys(a));
  for (const id of Object.keys(a)) assert.equal(a[id], b[id], id);
});

test('the documents state the resolved values', () => {
  const t = table('REQUIREMENTS.md');
  assert.match(t.R1, /\b7\b/);
  assert.match(t.R2, /\b30\b/);
  assert.match(t.R3, /half.?up/i);
  assert.doesNotMatch(t.R3, /even|banker/i);
  assert.match(t.R4, /\b5\b/);
  assert.match(t.R5, /^10$/);
  assert.match(t.R6, /include/i);
  assert.doesNotMatch(t.R6, /exclude/i);
  assert.match(t.R7, /\b20\b/);
  assert.match(t.R9, /immediate/i);
  assert.match(t.R10, /4\.50|\b450\b/);
  assert.doesNotMatch(t.R10, /\b500\b/);
});

test('docs/DECISIONS.md names every conflicting rule', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'docs', 'DECISIONS.md'), 'utf8');
  for (const id of ['R1', 'R2', 'R3', 'R5', 'R6', 'R7', 'R9', 'R10']) assert.match(text, new RegExp(`\\b${id}\\b`), id);
});

test('rules the documents agree on are not listed as table rows in DECISIONS.md', () => {
  const rows = fs.readFileSync(path.join(__dirname, '..', 'docs', 'DECISIONS.md'), 'utf8').split('\n').filter((l) => l.trim().startsWith('|'));
  for (const id of ['R4', 'R8']) assert.ok(!rows.some((l) => new RegExp(`^\\|\\s*${id}\\b`).test(l.trim())), id);
});
