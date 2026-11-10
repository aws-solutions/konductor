import { chromium } from '@playwright/test';

export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://console.example.test/login');
  await page.locator('input[name="username"]').fill('e2e-admin');
  await page.locator('input[name="password"]').fill('Hunter2-e2e!');
  await page.locator('input[name="signInSubmitButton"]').click();
  await page.waitForURL('**', { waitUntil: 'networkidle' });
  await page.context().storageState({ path: 'fixtures/auth/state.json' });
  await browser.close();
}
