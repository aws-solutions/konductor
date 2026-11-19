import { test, expect } from '@playwright/test';

test('home page shows the shop name', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('h1')).toHaveText('Fernwood Books');
});
