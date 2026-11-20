'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { onCheckout, amount } = require('./helpers.js');

test('basket: raising the Assam quantity to 3 raises the total to £57.49', () => onCheckout(async (page) => {
  await page.getByRole('spinbutton', { name: 'Quantity for Assam breakfast tea, 250 g' }).fill('3');
  assert.equal(await amount(page, 'Total'), '£57.49');
  assert.match(await page.getByRole('listitem').first().innerText(), /£25\.50/);
}));

test('basket: removing the teapot leaves the teas and charges £4.50 delivery', () => onCheckout(async (page) => {
  await page.getByRole('button', { name: 'Remove Glass teapot, 600 ml' }).click();
  const items = await page.getByRole('listitem').allInnerTexts();
  assert.equal(items.length, 2);
  assert.ok(items.every((t) => !t.includes('Glass teapot')));
  assert.equal(await amount(page, 'Delivery'), '£4.50');
  assert.equal(await amount(page, 'Total'), '£33.50');
}));

test('basket: emptying it shows the empty note and blocks ordering', () => onCheckout(async (page) => {
  while (await page.getByRole('button', { name: /^Remove / }).count()) {
    await page.getByRole('button', { name: /^Remove / }).first().click();
  }
  assert.ok(await page.getByText('Your basket is empty').isVisible());
  assert.equal(await page.getByRole('button', { name: 'Place order' }).isEnabled(), false);
}));

test('delivery: express is £9.00 even above the free-delivery threshold', () => onCheckout(async (page) => {
  assert.equal(await amount(page, 'Delivery'), 'Free');
  await page.getByRole('radio', { name: 'Express (next day)' }).check();
  assert.equal(await amount(page, 'Delivery'), '£9.00');
  assert.equal(await amount(page, 'Total'), '£57.99');
}));
