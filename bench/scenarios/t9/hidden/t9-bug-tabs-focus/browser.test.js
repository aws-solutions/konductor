const test = require('node:test');
const assert = require('node:assert/strict');
const helper = require('./bench-browser.js');

const { open } = helper;

async function pageForTest() {
  const app = await open(__dirname, { timeoutMs: 5000 });
  await app.page.goto(`${app.url}/index.html`);
  return app;
}

test('the settings tabs expose one selected and tabbable section', async () => {
  const app = await pageForTest();
  try {
    const general = app.page.getByRole('tab', { name: /General/ });
    assert.equal(await general.getAttribute('aria-selected'), 'true');
    assert.equal(await general.getAttribute('tabindex'), '0');
    assert.equal(await app.page.getByRole('tab', { name: /Alerts/ }).getAttribute('tabindex'), '-1');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('closing a focused tab selects and focuses its successor', async () => {
  const app = await pageForTest();
  try {
    const alerts = app.page.getByRole('tab', { name: /Alerts/ });
    await alerts.focus();
    await app.page.getByRole('button', { name: 'Close Alerts tab' }).press('Enter');
    await assert.doesNotReject(() => app.page.getByRole('tab', { name: /Alerts/ }).waitFor({ state: 'detached' }));
    const team = app.page.getByRole('tab', { name: /Team/ });
    assert.equal(await team.getAttribute('tabindex'), '0');
    assert.equal(await team.getAttribute('aria-selected'), 'true');
    assert.equal(await team.evaluate((node) => document.activeElement === node), true);
  } finally { await app.close(); }
});

test('closing the last tab leaves the previous section in the tab order', async () => {
  const app = await pageForTest();
  try {
    const billing = app.page.getByRole('tab', { name: /Billing/ });
    await billing.focus();
    await app.page.getByRole('button', { name: 'Close Billing tab' }).press('Enter');
    const team = app.page.getByRole('tab', { name: /Team/ });
    assert.equal(await team.getAttribute('tabindex'), '0');
    assert.equal(await team.getAttribute('aria-selected'), 'true');
    assert.equal(await app.page.getByRole('tab', { name: /Billing/ }).count(), 0);
  } finally { await app.close(); }
});

test('disabling the selected section selects the next available section', async () => {
  const app = await pageForTest();
  try {
    const alerts = app.page.getByRole('tab', { name: /Alerts/ });
    await alerts.focus();
    const disable = app.page.getByRole('button', { name: 'Disable active section' });
    await disable.focus();
    await disable.press('Enter');
    assert.equal(await alerts.getAttribute('aria-disabled'), 'true');
    assert.equal(await alerts.getAttribute('tabindex'), '-1');
    const team = app.page.getByRole('tab', { name: /Team/ });
    assert.equal(await team.getAttribute('tabindex'), '0');
    assert.equal(await team.getAttribute('aria-selected'), 'true');
  } finally { await app.close(); }
});

test('the toolbar also restores its tab stop after a tool is disabled', async () => {
  const app = await pageForTest();
  try {
    const format = app.page.getByRole('button', { name: 'Format' });
    await format.focus();
    const disable = app.page.getByRole('button', { name: 'Disable active tool' });
    await disable.focus();
    await disable.press('Enter');
    assert.equal(await format.isDisabled(), true);
    assert.equal(await format.getAttribute('tabindex'), '-1');
    assert.equal(await app.page.getByRole('button', { name: 'History' }).getAttribute('tabindex'), '0');
  } finally { await app.close(); }
});
