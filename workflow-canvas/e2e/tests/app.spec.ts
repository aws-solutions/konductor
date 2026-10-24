// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';

test('loads with the page title in the main landmark', async ({ canvas }) => {
  await expect(canvas.main).toBeVisible();
  await expect(canvas.title).toHaveText('Workflow canvas');
  await expect(canvas.page).toHaveTitle('Workflow canvas');
});

test('starts on the Designer tab', async ({ canvas }) => {
  await canvas.expectTabShown('Designer');
});

test('switches from Designer to Execution and back', async ({ canvas }) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabShown('Execution');

  await canvas.selectTab('Designer');
  await canvas.expectTabShown('Designer');
});
