// SPDX-License-Identifier: Apache-2.0
import { test } from '../support/fixtures';
import { saveFullPageScreenshot } from '../support/screenshots';
import { TAB_NAMES } from '../support/workflow-canvas-page';

// Run with `npm run screenshots`. These tests assert nothing: they only
// regenerate the PNGs that PR descriptions embed.
for (const name of TAB_NAMES) {
  test(`capture the ${name} tab`, async ({ canvas }) => {
    await canvas.selectTab(name);

    await saveFullPageScreenshot(canvas.page, `${name.toLowerCase()}-tab`);
  });
}
