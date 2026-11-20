import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-browser-helper-'));
const helperPath = path.join(helperDir, 'bench-browser.cjs');
fs.copyFileSync(new URL('./bench-browser.js', import.meta.url), helperPath);
const { open } = require(helperPath);
test.after(() => fs.rmSync(helperDir, { recursive: true, force: true }));

const root = path.dirname(new URL(import.meta.url).pathname);

async function waitForHash(page, hash) {
  await page.waitForFunction((expected) => window.location.hash === expected, hash);
}

async function assertArticleState(page, tabName, title, headingName, expectedHash = null) {
  expectedHash ??= `#${tabName.toLowerCase().replaceAll(' ', '-')}`;
  assert.equal(new URL(page.url()).hash, expectedHash);
  assert.equal(await page.getByRole('tab', { name: tabName, exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.title(), `${title} | Northstar Help Centre`);
  const heading = page.getByRole('heading', { name: headingName, exact: true });
  assert.equal(await heading.isVisible(), true);
  await page.waitForFunction((expected) => document.activeElement?.textContent.trim() === expected, headingName);
  assert.equal(await heading.evaluate((element) => element === document.activeElement), true);
}

test('an article restored with Back keeps its initial hash state', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/index.html#getting-started`);
    await app.page.getByRole('tab', { name: 'Billing', exact: true }).click();
    await app.page.goBack();
    await waitForHash(app.page, '#getting-started');
    await assertArticleState(app.page, 'Getting started', 'Getting started', 'Make your first Northstar workspace useful');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('a mouse-selected article is restored by Back with matching accessibility state', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/index.html`);
    await app.page.getByRole('tab', { name: 'Security', exact: true }).click();
    await app.page.goBack();
    await waitForHash(app.page, '');
    await assertArticleState(app.page, 'Getting started', 'Getting started', 'Make your first Northstar workspace useful', '');
    assert.equal(await app.page.getByRole('tab', { name: 'Security', exact: true }).getAttribute('aria-selected'), 'false');
  } finally {
    await app.close();
  }
});

test('Forward restores the later article title and focused heading', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/index.html`);
    await app.page.getByRole('tab', { name: 'Billing', exact: true }).click();
    await app.page.goBack();
    await waitForHash(app.page, '');
    await assertArticleState(app.page, 'Getting started', 'Getting started', 'Make your first Northstar workspace useful', '');
    await app.page.goForward();
    await waitForHash(app.page, '#billing');
    await assertArticleState(app.page, 'Billing', 'Billing', 'Keep invoices easy to find');
  } finally {
    await app.close();
  }
});

test('Enter on a section link makes one navigable history entry', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/index.html#getting-started`);
    const billing = app.page.getByRole('tab', { name: 'Billing', exact: true });
    await billing.focus();
    await app.page.keyboard.press('Enter');
    await waitForHash(app.page, '#billing');
    await assertArticleState(app.page, 'Billing', 'Billing', 'Keep invoices easy to find');
    await app.page.goBack();
    await waitForHash(app.page, '#getting-started');
    await assertArticleState(app.page, 'Getting started', 'Getting started', 'Make your first Northstar workspace useful');
  } finally {
    await app.close();
  }
});

test('the account page restores its selected section through Back', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/account.html#profile`);
    await app.page.getByRole('tab', { name: 'Security', exact: true }).click();
    await app.page.goBack();
    await waitForHash(app.page, '#profile');
    await assertArticleState(app.page, 'Profile', 'Profile', 'Profile');
  } finally {
    await app.close();
  }
});

test('the account page restores the notification section through Forward', async () => {
  const app = await open(root);
  try {
    await app.page.goto(`${app.url}/account.html#profile`);
    await app.page.getByRole('tab', { name: 'Notifications', exact: true }).click();
    await app.page.goBack();
    await waitForHash(app.page, '#profile');
    await app.page.goForward();
    await waitForHash(app.page, '#notifications');
    await assertArticleState(app.page, 'Notifications', 'Notifications', 'Notifications');
  } finally {
    await app.close();
  }
});
