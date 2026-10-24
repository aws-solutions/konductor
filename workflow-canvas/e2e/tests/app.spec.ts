// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';
import { TAB_NAMES } from '../support/workflow-canvas-page';

test('loads with the page title in the main landmark', async ({ canvas }) => {
  await expect(canvas.main).toBeVisible();
  await expect(canvas.title).toHaveText('Workflow canvas');
  await expect(canvas.page).toHaveTitle('Workflow canvas');
});

test('starts on the Designer tab', async ({ canvas }) => {
  await expect(canvas.tab('Designer')).toHaveAttribute('aria-selected', 'true');
  await expect(canvas.tab('Execution')).toHaveAttribute(
    'aria-selected',
    'false',
  );
});

for (const name of TAB_NAMES) {
  test(`switches to the ${name} tab`, async ({ canvas }) => {
    await canvas.selectTab(name);

    await expect(canvas.tab(name)).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.tabPanel(name)).toContainText('Nothing here yet.');
  });
}
