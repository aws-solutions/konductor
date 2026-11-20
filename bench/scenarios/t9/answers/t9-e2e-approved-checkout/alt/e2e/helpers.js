'use strict';

const { openSite } = require('./support/browser.js');

// Opens the checkout page, runs `fn(page)`, and always closes the browser.
async function onCheckout(fn) {
  const app = await openSite();
  try {
    await app.page.goto(`${app.url}/index.html`);
    await fn(app.page);
    if (app.errors.length) throw new Error(`page errors: ${app.errors.join('; ')}`);
  } finally {
    await app.close();
  }
}

// The value shown next to a summary term ("Subtotal", "Delivery", "Discount", "Total"), or null when that row is hidden.
async function amount(page, term) {
  const dt = page.locator('dt', { hasText: new RegExp(`^${term}$`) });
  if (!(await dt.count()) || !(await dt.isVisible())) return null;
  return (await dt.locator('xpath=following-sibling::dd[1]').innerText()).trim();
}

const applyCode = async (page, code) => {
  await page.getByRole('textbox', { name: 'Promo code' }).fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
};

module.exports = { onCheckout, amount, applyCode };
