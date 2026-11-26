// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/fixtures';

const READY = 'Adversarial pull request review';
const PLANNED = 'Design document creation';

async function openLibrary(page: Page) {
  await page.getByRole('tab', { name: 'Library' }).click();
  await expect(page.getByText(READY)).toBeVisible();
}

test('lists ready and planned workflows with focusable unavailable actions', async ({
  canvas,
}) => {
  await openLibrary(canvas.page);

  await expect(canvas.page.getByText(PLANNED)).toBeVisible();
  await expect(
    canvas.page.getByText('The workflow needs human gates.').last(),
  ).toBeVisible();
  for (const name of [
    `Open ${READY}`,
    `Start from ${READY}`,
    `Open ${PLANNED}`,
    `Start from ${PLANNED}`,
  ]) {
    const button = canvas.page.getByRole('button', { name });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await button.focus();
    await expect(button).toBeFocused();
  }
});

test('shows an empty Library explicitly', async ({ canvas }) => {
  await canvas.page.route('**/api/library', (route) =>
    route.fulfill({ json: { entries: [] } }),
  );

  await canvas.page.getByRole('tab', { name: 'Library' }).click();

  await expect(
    canvas.page.getByText('No shipped workflows are available.'),
  ).toBeVisible();
});

test('has no accessibility violations in the Library in both themes', async ({
  canvas,
}) => {
  await openLibrary(canvas.page);
  await expectNoAccessibilityViolations(canvas.page);

  await canvas.switchTheme();
  await expectNoAccessibilityViolations(canvas.page);
});
