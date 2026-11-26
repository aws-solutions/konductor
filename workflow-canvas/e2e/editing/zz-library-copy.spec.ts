// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';

const READY = 'Adversarial pull request review';

test('copies a library workflow, edits it, and saves the copy', async ({
  canvas,
}) => {
  await canvas.page.getByRole('tab', { name: 'Library' }).click();
  await canvas.page.getByRole('button', { name: `Open ${READY}` }).click();
  await expect(canvas.page.getByTestId('read-only-note')).toBeVisible();

  await canvas.page
    .getByRole('button', { name: 'Start from', exact: true })
    .click();
  const dialog = canvas.page.getByRole('dialog');
  await dialog.getByLabel('Workflow name').fill('library-e2e-copy');
  await dialog.getByRole('button', { name: 'Create copy' }).click();

  await expect(canvas.title).toHaveText('library-e2e-copy');
  await expect(canvas.page.getByRole('tab', { name: 'Design' })).toBeFocused();
  await canvas.page.getByRole('tab', { name: 'Properties' }).click();
  const properties = canvas.page.getByRole('tabpanel', { name: 'Properties' });
  await properties.getByLabel('name', { exact: true }).fill('collect-input');
  await canvas.page.getByRole('button', { name: 'Save' }).click();
  await expect(canvas.page.getByTestId('save-status')).toContainText('Saved');

  await canvas.page.reload();
  await expect(canvas.title).toHaveText('library-e2e-copy');
  await expect(
    canvas.page.getByTestId('node-stage-collect-input'),
  ).toBeVisible();
});
