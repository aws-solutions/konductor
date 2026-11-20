'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openSite } = require('./support/browser.js');

test('checkout page opens with the shop name and no script errors', async () => {
  const app = await openSite();
  try {
    await app.page.goto(`${app.url}/index.html`);
    assert.equal(await app.page.getByRole('heading', { level: 1 }).textContent(), 'Larkspur Tea');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
