// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';
import { saveFullPageScreenshot } from '../support/screenshots';
import { STEP_TIMEOUT_MS } from '../support/workflow-canvas-page';

// Run with `npm run screenshots`. These tests assert only what they must to
// reach the state they save: they regenerate the PNGs that PR descriptions
// embed.
test('capture the Designer tab', async ({ canvas }) => {
  await canvas.selectTab('Designer');
  await canvas.expectTabLoaded('Designer');

  await saveFullPageScreenshot(canvas.page, 'designer-tab');
});

// The Designer tab in the dark mode, switched with the button like a person would.
test('capture the Designer tab in the dark mode', async ({ canvas }) => {
  await canvas.switchTheme();
  await canvas.expectTabLoaded('Designer');

  await saveFullPageScreenshot(canvas.page, 'designer-tab-dark');
});

// A run on the stub, saved before it starts, while its first stage runs and
// after it passed. The stub allows one run at a time, so this is one test
// that waits for the end.
test('capture the Execution tab before, during and after a run', async ({
  canvas,
}) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');
  await saveFullPageScreenshot(canvas.page, 'execution-tab-idle');

  await canvas.runButton.click();
  await expect(canvas.badge('node-stage-draft')).toHaveText('Running', {
    timeout: STEP_TIMEOUT_MS,
  });
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await saveFullPageScreenshot(canvas.page, 'execution-tab-running');

  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
  await expect(canvas.runStatus).toContainText('Run passed.');
  await saveFullPageScreenshot(canvas.page, 'execution-tab-finished');
});

// The Execution tab in the dark mode, while the first stage runs.
test('capture the Execution tab in the dark mode during a run', async ({
  canvas,
}) => {
  await canvas.switchTheme();
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await expect(canvas.badge('node-stage-draft')).toHaveText('Running', {
    timeout: STEP_TIMEOUT_MS,
  });
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await saveFullPageScreenshot(canvas.page, 'execution-tab-dark');

  // Leave the stub free for whatever runs next.
  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
});
