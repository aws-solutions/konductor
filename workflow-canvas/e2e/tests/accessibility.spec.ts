// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { test } from '../support/fixtures';
import { TAB_NAMES, WorkflowCanvasPage } from '../support/workflow-canvas-page';

for (const name of TAB_NAMES) {
  test(`${name} tab has no axe violations`, async ({ canvas }) => {
    await canvas.selectTab(name);
    await canvas.expectTabLoaded(name);

    await expectNoAccessibilityViolations(canvas.page);
  });
}

test('Designer tab has no axe violations when the workflow did not load', async ({
  page,
}) => {
  const canvas = new WorkflowCanvasPage(page);
  await canvas.open('not-the-launch-code');
  await page.getByText('The workflow did not load').waitFor();

  await expectNoAccessibilityViolations(page);
});
