// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';

test('loads with the workflow name as the title in the main landmark', async ({
  canvas,
}) => {
  await expect(canvas.main).toBeVisible();
  await expect(canvas.title).toHaveText('hello');
  await expect(canvas.page).toHaveTitle('Workflow canvas');
});

test('starts on the Design view', async ({ canvas }) => {
  await canvas.expectTabShown('Design');
});

test('switches with the arrow keys and keeps one tab stop', async ({
  canvas,
}) => {
  await canvas.tab('Design').focus();

  await canvas.page.keyboard.press('ArrowRight');
  await canvas.expectTabShown('Run');
  await expect(canvas.tab('Run')).toBeFocused();

  await canvas.page.keyboard.press('ArrowLeft');
  await canvas.expectTabShown('Design');
  await expect(canvas.tab('Design')).toBeFocused();
  await expect(canvas.tab('Run')).toHaveAttribute('tabindex', '-1');
});

test('switches from Design to Run and back', async ({ canvas }) => {
  await canvas.selectTab('Run');
  await canvas.expectTabShown('Run');

  await canvas.selectTab('Design');
  await canvas.expectTabShown('Design');
});
