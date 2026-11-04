// SPDX-License-Identifier: Apache-2.0
import { test } from '../support/fixtures';
import { saveFullPageScreenshot } from '../support/screenshots';
import { TAB_NAMES } from '../support/workflow-canvas-page';

// Run with `npm run screenshots`. These tests assert nothing: they only
// regenerate the PNGs that PR descriptions embed.
for (const name of TAB_NAMES) {
  test(`capture the ${name} tab`, async ({ canvas }) => {
    await canvas.selectTab(name);
    await canvas.expectTabLoaded(name);

    await saveFullPageScreenshot(canvas.page, `${name.toLowerCase()}-tab`);
  });
}

// The Designer tab in the dark mode, switched with the button like a person would.
test('capture the Designer tab in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.expectTabLoaded('Designer');

  await saveFullPageScreenshot(canvas.page, 'designer-tab-dark');
});
