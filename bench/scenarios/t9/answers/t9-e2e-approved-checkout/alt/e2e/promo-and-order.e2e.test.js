'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { onCheckout, amount, applyCode } = require('./helpers.js');

test('promo: STEEP5 takes £5.00 off and the total follows', () => onCheckout(async (page) => {
  await applyCode(page, 'steep5');
  assert.equal(await amount(page, 'Discount'), '-£5.00');
  assert.equal(await amount(page, 'Total'), '£43.99');
}));

test('promo: a bad code after a good one is refused and the discount goes away', () => onCheckout(async (page) => {
  await applyCode(page, 'STEEP5');
  await applyCode(page, 'FREE-TEA');
  assert.match(await page.getByRole('alert').innerText(), /not valid/);
  assert.equal(await amount(page, 'Discount'), null);
  assert.equal(await amount(page, 'Total'), '£48.99');
}));

test('details: a bad email blocks the order, is marked and gets the focus', () => onCheckout(async (page) => {
  await page.getByLabel('Full name').fill('Tom Reyes');
  await page.getByLabel('Email').fill('tom.example.com');
  await page.getByLabel('Postcode').fill('M1 1AE');
  await page.getByRole('button', { name: 'Place order' }).click();
  const email = page.getByLabel('Email');
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.getByLabel('Full name').getAttribute('aria-invalid'), null);
  assert.ok(await email.evaluate((el) => el === document.activeElement));
  assert.equal(await page.getByText('Thank you for your order').isVisible(), false);
}));

test('order: the confirmation repeats the email and the total after a code and express delivery', () => onCheckout(async (page) => {
  await applyCode(page, 'STEEP5');
  await page.getByRole('radio', { name: 'Express (next day)' }).check();
  const shown = await amount(page, 'Total');
  assert.equal(shown, '£52.99');
  await page.getByLabel('Full name').fill('Tom Reyes');
  await page.getByLabel('Email').fill('tom@example.com');
  await page.getByLabel('Postcode').fill('M1 1AE');
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.getByRole('heading', { name: 'Thank you for your order' }).waitFor();
  const text = await page.getByRole('heading', { name: 'Thank you for your order' }).locator('..').innerText();
  assert.match(text, /tom@example\.com/);
  assert.ok(text.includes(`Order total: ${shown}`));
}));
