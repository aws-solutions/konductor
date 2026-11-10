import { test, expect } from '@playwright/test';

test('create distribution with new bucket', async ({ page }) => {
  await page.goto('/distributions/create');
  await page.getByRole('radio', { name: 'Create new S3 bucket' }).click();
  await page.locator('.awsui-input').first().fill('my-dist');
  await page.getByRole('option', { name: 'All edge locations' }).click();
  await page.locator('button').first().click();
  await expect(page).toHaveURL(/distributions/);
});

test('delete a distribution', async ({ page }) => {
  await page.goto('/distributions');
  await page.locator('tr').nth(1).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: /cancel/i }).click();
});
