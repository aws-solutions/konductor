'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('./bench-browser.js');

async function visit(setup) {
  const app = await open(__dirname, { timeoutMs: 5000 });
  try {
    if (setup) await setup(app.page);
    await app.page.goto(`${app.url}/index.html`);
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function finish(app) {
  assert.deepEqual(app.errors, []);
  await app.close();
}

test('country field exposes the combobox and collapsed list state', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
    assert.equal(await field.getAttribute('aria-autocomplete'), 'list');
    assert.ok(await field.getAttribute('aria-controls'));
    assert.equal(await app.page.locator('[role="listbox"]').getAttribute('hidden'), '');
    assert.match(await app.page.getByRole('status').filter({ hasText: 'Start typing' }).textContent(), /Start typing/);
  } finally { await finish(app); }
});

test('typing opens a ranked list of accessible options', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('cote');
    assert.equal(await field.getAttribute('aria-expanded'), 'true');
    const options = app.page.getByRole('option');
    assert.equal(await options.count(), 1);
    assert.equal(await options.first().textContent(), 'Côte d’Ivoire');
    assert.equal(await app.page.locator('[role="listbox"]').getAttribute('hidden'), null);
  } finally { await finish(app); }
});

test('arrow navigation exposes the active option and Enter chooses it', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('can');
    await field.press('ArrowDown');
    await field.press('ArrowDown');
    await field.press('ArrowUp');
    const active = await field.getAttribute('aria-activedescendant');
    assert.ok(active);
    assert.equal(await app.page.locator(`[id="${active}"]`).getAttribute('role'), 'option');
    assert.equal(await app.page.locator('[role="option"][aria-selected="true"]').count(), 1);
    await field.press('Enter');
    assert.equal(await field.inputValue(), 'Canada');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'CA');
    assert.equal(await app.page.locator('[role="option"][aria-selected="true"]').textContent(), 'Canada');
  } finally { await finish(app); }
});

test('clicking a suggestion stores its code and closes the menu', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('japan');
    await app.page.getByRole('option', { name: 'Japan' }).click();
    assert.equal(await field.inputValue(), 'Japan');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'JP');
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
    assert.equal(await app.page.locator('[role="option"][aria-selected="true"]').textContent(), 'Japan');
  } finally { await finish(app); }
});

test('Escape closes an open menu and an empty query announces its prompt', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('fra');
    await field.press('Escape');
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
    await field.fill('');
    assert.match(await app.page.getByRole('status').filter({ hasText: 'Start typing' }).textContent(), /Start typing/);
  } finally { await finish(app); }
});

test('a query with no matches announces a polite status message', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('zzzzzzzz');
    assert.match(await app.page.getByRole('status').filter({ hasText: 'No countries' }).textContent(), /No countries match/);
    assert.equal(await field.getAttribute('aria-expanded'), 'false');
  } finally { await finish(app); }
});

test('country names containing angle brackets remain text', async () => {
  const app = await visit();
  try {
    await app.page.getByRole('combobox', { name: 'Country' }).fill('aland');
    const option = app.page.getByRole('option', { name: 'Aland <North>' });
    assert.equal(await option.count(), 1);
    assert.equal(await option.textContent(), 'Aland <North>');
    assert.equal(await app.page.locator('script').count(), 1);
  } finally { await finish(app); }
});

test('the documented sorter hook is used and a later query clears the old code', async () => {
  const app = await visit(async (page) => {
    await page.addInitScript(() => {
      window.__countryPickerRank = (query, items) => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())).reverse();
    });
  });
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('a');
    assert.equal((await app.page.getByRole('option').first().textContent()), 'Zimbabwe');
    await field.fill('canada');
    await field.press('ArrowDown');
    await field.press('Enter');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'CA');
    await field.fill('fr');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), '');
  } finally { await finish(app); }
});

test('an accented country can be selected with the keyboard', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('reunion');
    await field.press('ArrowDown');
    await field.press('Enter');
    assert.equal(await field.inputValue(), 'Réunion');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'RE');
  } finally { await finish(app); }
});

test('an angle-bracket country can be selected by clicking its text', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('aland');
    await app.page.getByRole('option', { name: 'Aland <North>' }).click();
    assert.equal(await field.inputValue(), 'Aland <North>');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'AX');
  } finally { await finish(app); }
});

test('editing a selected country clears its hidden code', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('canada');
    await app.page.getByRole('option', { name: 'Canada' }).click();
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'CA');
    await field.fill('japan');
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), '');
  } finally { await finish(app); }
});

test('the registration form still announces a successful submission', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('canada');
    await app.page.getByRole('option', { name: 'Canada' }).click();
    assert.equal(await app.page.locator('[name="country_code"]').inputValue(), 'CA');
    await app.page.getByLabel('Your name').fill('Mina');
    await app.page.getByLabel('Email address').fill('mina@example.test');
    await app.page.getByRole('button', { name: 'Register' }).click();
    assert.equal(await app.page.locator('#form-message').textContent(), 'Your registration is on the list.');
  } finally { await finish(app); }
});

test('ArrowUp wraps to the last visible option', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('a');
    const options = app.page.getByRole('option');
    const lastId = await options.last().getAttribute('id');
    await field.press('ArrowUp');
    assert.equal(await field.getAttribute('aria-activedescendant'), lastId);
    assert.equal(await app.page.locator('[role="option"][aria-selected="true"]').count(), 1);
  } finally { await finish(app); }
});

test('every rendered suggestion has an id and an explicit selection state', async () => {
  const app = await visit();
  try {
    const field = app.page.getByRole('combobox', { name: 'Country' });
    await field.fill('a');
    const options = app.page.getByRole('option');
    assert.ok(await options.count() > 1);
    const ids = [];
    for (let index = 0; index < await options.count(); index += 1) {
      ids.push(await options.nth(index).getAttribute('id'));
      assert.equal(await options.nth(index).getAttribute('aria-selected'), 'false');
    }
    assert.equal(new Set(ids).size, ids.length);
  } finally { await finish(app); }
});
