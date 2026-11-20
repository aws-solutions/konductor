'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openSite } = require('./support/browser.js');

test('a shopper can place an order', async () => {
  const app = await openSite();
  try {
    await app.page.goto(`${app.url}/index.html`);
    await app.page.getByLabel('Full name').fill('Mira Okafor');
    await app.page.getByLabel('Email').fill('mira@example.com');
    await app.page.getByLabel('Postcode').fill('EH1 1YZ');
    await app.page.getByRole('button', { name: 'Place order' }).click();
    assert.ok(await app.page.getByRole('heading', { name: 'Thank you for your order' }).isVisible());
    assert.match(await app.page.locator('body').innerText(), /Order total: £48\.99/);
  } finally {
    await app.close();
  }
});
