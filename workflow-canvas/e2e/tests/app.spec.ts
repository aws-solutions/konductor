// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';

test('loads with the workflow name as the title in the main landmark', async ({
  canvas,
}) => {
  await expect(canvas.main).toBeVisible();
  await expect(canvas.title).toHaveText('hello');
  await expect(canvas.page).toHaveTitle('Workflow canvas');
});

test('starts on the Designer tab', async ({ canvas }) => {
  await canvas.expectTabShown('Designer');
});

test('switches with the arrow keys and keeps one tab stop', async ({
  canvas,
}) => {
  await canvas.tab('Designer').focus();

  await canvas.page.keyboard.press('ArrowRight');
  await canvas.expectTabShown('Execution');
  await expect(canvas.tab('Execution')).toBeFocused();

  await canvas.page.keyboard.press('ArrowLeft');
  await canvas.expectTabShown('Designer');
  await expect(canvas.tab('Designer')).toBeFocused();
  await expect(canvas.tab('Execution')).toHaveAttribute('tabindex', '-1');
});

test('switches from Designer to Execution and back', async ({ canvas }) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabShown('Execution');

  await canvas.selectTab('Designer');
  await canvas.expectTabShown('Designer');
});
