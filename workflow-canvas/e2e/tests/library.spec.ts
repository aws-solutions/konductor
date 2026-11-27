// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { expect, test } from '../support/fixtures';

const READY = 'Adversarial pull request review';
const PLANNED = 'Design document creation';

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText(READY)).toBeVisible();
}

test('lists and opens a ready library workflow read-only', async ({
  canvas,
}) => {
  await openLibrary(canvas.page);
  await canvas.page.getByRole('button', { name: `Open ${READY}` }).click();

  const back = canvas.page.getByRole('button', { name: 'Back to Library' });
  await expect(back).toBeFocused();
  await expect(canvas.page.getByTestId('read-only-note')).toBeVisible();
  await expect(canvas.page.getByTestId('node-stage-ingest')).toBeVisible();
  await expect(canvas.page.getByTestId('yaml-text')).not.toBeEditable();

  await back.click();
  await expect(
    canvas.page.getByRole('button', { name: `Open ${READY}` }),
  ).toBeFocused();
});

test('keeps a planned workflow unavailable with its reason', async ({
  canvas,
}) => {
  await openLibrary(canvas.page);

  await expect(canvas.page.getByText(PLANNED)).toBeVisible();
  await expect(
    canvas.page.getByText('The workflow needs human gates.').last(),
  ).toBeVisible();
  await expect(
    canvas.page.getByRole('button', { name: `Start from ${PLANNED}` }),
  ).toHaveAttribute('aria-disabled', 'true');
});

test('keeps Start from unavailable while a run is active', async ({
  canvas,
}) => {
  await canvas.selectTab('Run');
  await canvas.runButton.click();
  await expect(canvas.page.getByTestId('run-progress')).toContainText('draft');

  await openLibrary(canvas.page);
  const startFrom = canvas.page.getByRole('button', {
    name: `Start from ${READY}`,
  });
  await expect(startFrom).toHaveAttribute('aria-disabled', 'true');
  await startFrom.hover();
  await expect(canvas.page.getByRole('tooltip')).toContainText(
    'A run is already active in this workspace.',
  );
});

test('shows a copy refusal when a run starts after the dialog opens', async ({
  canvas,
}) => {
  const refusal = 'A run is already active in this workspace.';
  await canvas.page.route('**/api/library/*/copy', (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: refusal,
        code: 'already_running',
        run_id: '20261024-0412-a7b3c',
      },
    }),
  );
  await openLibrary(canvas.page);
  await canvas.page
    .getByRole('button', { name: `Start from ${READY}` })
    .click();
  const dialog = canvas.page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create copy' }).click();

  await expect(dialog).toContainText(refusal);
  await expect(dialog).toBeVisible();
});

test('reports a workflow name clash without closing the dialog', async ({
  canvas,
}) => {
  await openLibrary(canvas.page);
  await canvas.page
    .getByRole('button', { name: `Start from ${READY}` })
    .click();
  const dialog = canvas.page.getByRole('dialog');
  await dialog.getByLabel('Workflow name').fill('hello');
  await dialog.getByRole('button', { name: 'Create copy' }).click();

  await expect(dialog).toContainText(
    'A workflow with this name already exists.',
  );
  await expect(dialog).toBeVisible();
});

test('shows an empty Library explicitly', async ({ canvas }) => {
  await canvas.page.route('**/api/library', (route) =>
    route.fulfill({ json: { entries: [] } }),
  );

  await canvas.page.getByRole('button', { name: 'Library' }).click();

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
