// SPDX-License-Identifier: Apache-2.0
import { expectNoAccessibilityViolations } from '../support/accessibility';
import { test } from '../support/fixtures';
import { TAB_NAMES } from '../support/workflow-canvas-page';

for (const name of TAB_NAMES) {
  test(`${name} tab has no axe violations`, async ({ canvas }) => {
    await canvas.selectTab(name);

    await expectNoAccessibilityViolations(canvas.page);
  });
}
