// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/fixtures';
import { answerRunsWith, runReply } from '../support/run-routes';
import { saveFullPageScreenshot } from '../support/screenshots';
import type { WorkflowCanvasPage } from '../support/workflow-canvas-page';

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

// After the click the pointer and the focus are still on Run, which is now off
// and shows its reason in a tooltip. A capture takes the page without it, so it
// does not depend on how fast the tooltip appears.
async function leaveRunButton(canvas: WorkflowCanvasPage): Promise<void> {
  await canvas.page.mouse.move(0, 0);
  await canvas.runButton.blur();
}

// The Execution tab before a run, drawn from the stub.
test('capture the Execution tab before a run', async ({ canvas }) => {
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await saveFullPageScreenshot(canvas.page, 'execution-tab-idle');
});

// The runs below answer with fixed replies, not a run on the stub, so a
// capture never races the three seconds that a stage takes there.
test('capture the Execution tab while the first stage runs', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await leaveRunButton(canvas);

  await saveFullPageScreenshot(canvas.page, 'execution-tab-running');
});

test('capture the Execution tab after the run passed', async ({ canvas }) => {
  await answerRunsWith(canvas.page, runReply('passed', ['passed', 'passed']));
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await canvas.expectBadges(['Done', 'Done', 'Done', 'Passed']);
  await expect(canvas.runStatus).toContainText('Run passed.');

  await saveFullPageScreenshot(canvas.page, 'execution-tab-finished');
});

// The Execution tab in the dark mode, while the first stage runs.
test('capture the Execution tab in the dark mode during a run', async ({
  canvas,
}) => {
  await answerRunsWith(
    canvas.page,
    runReply('running', ['running', 'pending']),
  );
  await canvas.switchTheme();
  await canvas.selectTab('Execution');
  await canvas.expectTabLoaded('Execution');

  await canvas.runButton.click();
  await canvas.expectBadges(['Done', 'Running', 'Queued', 'Queued']);
  await leaveRunButton(canvas);

  await saveFullPageScreenshot(canvas.page, 'execution-tab-dark');
});
