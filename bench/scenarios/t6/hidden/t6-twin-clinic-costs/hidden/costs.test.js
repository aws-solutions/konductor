'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf } = require('./doc-key');

const DOC = 'docs/cost-summary.md';
const CLINICS = ['Cedar Grove Rehab', 'Harbor Point Therapy', 'Northgate Mobility'];

function block() {
  return blockOf(DOC);
}

function row(name) {
  const found = block().clinics?.find((clinic) => clinic && clinic.name === name);
  assert.ok(found, `missing clinic row for ${name}`);
  return found;
}

test('JSON block has one row for each MotionSpring clinic', () => {
  const b = block();
  assert.ok(Array.isArray(b.clinics), 'clinics must be an array');
  assert.deepEqual(b.clinics.map((clinic) => clinic.name).sort(), [...CLINICS].sort());
  for (const clinic of b.clinics) {
    assert.equal(typeof clinic.bookedAppointments, 'number');
    assert.equal(typeof clinic.monthlyCostUsd, 'number');
  }
  assert.equal(typeof b.totalMonthlyCostUsd, 'number');
  assert.equal(typeof b.highestCostClinic, 'string');
});

test('Cedar Grove has three booked appointments in the working volume', () => {
  assert.equal(row('Cedar Grove Rehab').bookedAppointments, 3);
});

test('Harbor Point has two booked appointments in the working volume', () => {
  assert.equal(row('Harbor Point Therapy').bookedAppointments, 2);
});

test('Northgate has one booked appointment in the working volume', () => {
  assert.equal(row('Northgate Mobility').bookedAppointments, 1);
});

test('Cedar Grove receives a 90 dollar proportional monthly allocation', () => {
  assert.ok(Math.abs(row('Cedar Grove Rehab').monthlyCostUsd - 90) <= 0.01);
});

test('Harbor Point receives a 60 dollar proportional monthly allocation', () => {
  assert.ok(Math.abs(row('Harbor Point Therapy').monthlyCostUsd - 60) <= 0.01);
});

test('Northgate receives a 30 dollar proportional monthly allocation', () => {
  assert.ok(Math.abs(row('Northgate Mobility').monthlyCostUsd - 30) <= 0.01);
});

test('the allocated clinic costs total 180 dollars per month', () => {
  const b = block();
  const sum = b.clinics.reduce((total, clinic) => total + clinic.monthlyCostUsd, 0);
  assert.ok(Math.abs(sum - 180) <= 0.01);
  assert.ok(Math.abs(b.totalMonthlyCostUsd - 180) <= 0.01);
});

test('Cedar Grove is identified as the highest-cost clinic', () => {
  const b = block();
  assert.equal(b.highestCostClinic, 'Cedar Grove Rehab');
  const costs = b.clinics.map((clinic) => clinic.monthlyCostUsd);
  assert.equal(Math.max(...costs), row('Cedar Grove Rehab').monthlyCostUsd);
});

test('the explanation uses the quoted account allowance and shared-fee allocation', () => {
  const b = block();
  const text = JSON.stringify(b);
  assert.match(text, /180/);
  assert.match(text, /2,?000/);
  assert.match(text, /0\.06/);
  assert.match(text, /proportion|share|allocat/i);
});

test('the one-time setup charge is not counted as monthly clinic cost', () => {
  const b = block();
  assert.ok(b.totalMonthlyCostUsd < 1250, 'monthly total must not include the 1,250 setup charge');
  assert.ok(b.clinics.every((clinic) => clinic.monthlyCostUsd < 1250));
});

test('the optional unpriced inbound-reply add-on is not presented as a known cost', () => {
  const b = block();
  const text = JSON.stringify(b).toLowerCase();
  assert.match(text, /optional|unpriced|unknown|excluded|not included/);
  assert.ok(!b.clinics.some((clinic) => clinic.monthlyCostUsd > 180));
});

test('the booked-volume rows exclude the cancelled appointment', () => {
  const b = block();
  const count = b.clinics.reduce((total, clinic) => total + clinic.bookedAppointments, 0);
  assert.equal(count, 6);
});
