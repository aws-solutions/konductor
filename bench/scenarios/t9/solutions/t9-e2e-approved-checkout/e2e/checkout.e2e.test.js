'use strict';

// End-to-end tests of the checkout page, written against what a shopper sees: labels, roles and text.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { openSite } = require('./support/browser.js');

let app;
let page;

beforeEach(async () => {
  app = await openSite();
  page = app.page;
  await page.goto(`${app.url}/index.html`);
});

afterEach(async () => {
  assert.deepEqual(app.errors, []);
  await app.close();
});

const summary = () => page.getByRole('region', { name: 'Order summary' });
const summaryText = async () => (await summary().innerText()).replace(/\s+/g, ' ');
const row = async (label) => {
  const m = new RegExp(`(?:^| )${label} (Free|-?£\\d+\\.\\d\\d)`).exec(await summaryText());
  return m ? m[1] : null;
};

async function fillDetails(name, email, postcode) {
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Postcode').fill(postcode);
}

test('starting basket totals £48.99 with free standard delivery', async () => {
  assert.equal(await row('Subtotal'), '£48.99');
  assert.equal(await row('Delivery'), 'Free');
  assert.equal(await row('Total'), '£48.99');
});

test('changing a quantity updates the line price and the total', async () => {
  await page.getByLabel('Quantity for Assam breakfast tea, 250 g').fill('3');
  assert.equal(await row('Total'), '£57.49');
  const line = page.getByRole('listitem').filter({ hasText: 'Assam breakfast tea' });
  assert.match(await line.innerText(), /£25\.50/);
});

test('removing a line takes out that line only and brings back the delivery charge', async () => {
  await page.getByRole('button', { name: 'Remove Glass teapot, 600 ml' }).click();
  assert.equal(await page.getByRole('listitem').filter({ hasText: 'Glass teapot' }).count(), 0);
  assert.equal(await page.getByRole('listitem').filter({ hasText: 'Assam breakfast tea' }).count(), 1);
  assert.equal(await row('Delivery'), '£4.50');
  assert.equal(await row('Total'), '£33.50');
});

test('an empty basket says so and cannot be ordered', async () => {
  for (const name of ['Assam breakfast tea, 250 g', 'Sencha green tea, 100 g', 'Glass teapot, 600 ml']) {
    await page.getByRole('button', { name: `Remove ${name}` }).click();
  }
  assert.ok(await page.getByText('Your basket is empty').isVisible());
  assert.ok(await page.getByRole('button', { name: 'Place order' }).isDisabled());
});

test('LEAF10 shows a discount row and lowers the total; delivery stays free', async () => {
  await page.getByRole('textbox', { name: 'Promo code' }).fill('leaf10');
  await page.getByRole('button', { name: 'Apply' }).click();
  assert.match(await page.getByRole('status').innerText(), /LEAF10 applied/);
  assert.equal(await row('Discount'), '-£4.90');
  assert.equal(await row('Delivery'), 'Free');
  assert.equal(await row('Total'), '£44.09');
});

test('an unknown code shows an error and drops the code applied before', async () => {
  const code = page.getByRole('textbox', { name: 'Promo code' });
  await code.fill('LEAF10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await code.fill('NOTACODE');
  await page.getByRole('button', { name: 'Apply' }).click();
  assert.equal(await page.getByRole('alert').innerText(), 'That code is not valid');
  assert.equal(await row('Discount'), null);
  assert.equal(await row('Total'), '£48.99');
});

test('express delivery costs £9.00 whatever the subtotal', async () => {
  await page.getByLabel('Express (next day)').check();
  assert.equal(await row('Delivery'), '£9.00');
  assert.equal(await row('Total'), '£57.99');
});

test('placing an order with empty details marks every field and focuses the first', async () => {
  await page.getByRole('button', { name: 'Place order' }).click();
  for (const label of ['Full name', 'Email', 'Postcode']) {
    assert.equal(await page.getByLabel(label).getAttribute('aria-invalid'), 'true', label);
  }
  assert.ok(await page.getByText('Enter your full name').isVisible());
  assert.ok(await page.getByText(/Enter an email address/).isVisible());
  assert.equal(await page.getByRole('heading', { name: 'Thank you for your order' }).count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.labels?.[0]?.textContent), 'Full name');
});

test('a valid order shows the confirmation with the email and the discounted express total', async () => {
  await page.getByRole('textbox', { name: 'Promo code' }).fill('LEAF10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByLabel('Express (next day)').check();
  await fillDetails('Mira Okafor', 'mira@example.com', 'EH1 1YZ');
  await page.getByRole('button', { name: 'Place order' }).click();
  const thanks = page.getByRole('heading', { name: 'Thank you for your order' });
  assert.ok(await thanks.isVisible());
  const body = await page.locator('body').innerText();
  assert.match(body, /mira@example\.com/);
  assert.match(body, /Order total: £53\.09/);
});
