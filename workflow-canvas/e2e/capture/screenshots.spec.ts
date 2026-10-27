// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '../support/editing-fixtures';
import { overwriteWorkflow, SAMPLE_TEXT } from '../support/stub-workflow';
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

// Editing. Each test puts the stub's workflow back afterwards (the fixture
// does), so the captures above and below it see the sample.
// These two change what a stage says but add none: a longer graph is fitted at
// a fractional zoom, and the edges of such a view differ by a level of grey
// between machines, which the byte-exact check cannot take.
test('capture the Designer tab with unsaved edits', async ({ designer }) => {
  await designer.chooseAgent('k-architect');
  await designer.stage('review').click();
  await designer.rename('ship');
  await designer.expectStatus('Unsaved changes');

  await saveFullPageScreenshot(designer.page, 'designer-editing');
});

test('capture the Designer tab after a save', async ({ designer }) => {
  await designer.rename('write');
  await designer.save.click();
  await designer.expectStatus('Saved');
  await saveFullPageScreenshot(designer.page, 'designer-saved');
});

test('capture the Designer tab with a problem the server found', async ({
  designer,
}) => {
  await designer.stage('review').click();
  await designer.rename('draft');
  await expect(designer.problems).toBeVisible();

  await saveFullPageScreenshot(designer.page, 'designer-problems');
});

test('capture the Designer tab when the file changed on disk', async ({
  designer,
  request,
}) => {
  await designer.rename('write');
  await overwriteWorkflow(
    request,
    SAMPLE_TEXT.replace('k-quality-assurance', 'k-tpm'),
  );
  await designer.save.click();
  await expect(designer.conflict).toBeVisible();

  await saveFullPageScreenshot(designer.page, 'designer-conflict');
});

test('capture the Designer tab with unsaved edits in the dark mode', async ({
  canvas,
  designer,
}) => {
  await canvas.switchTheme();
  await designer.chooseAgent('k-architect');
  await designer.stage('review').click();
  await designer.rename('ship');
  await designer.expectStatus('Unsaved changes');

  await saveFullPageScreenshot(designer.page, 'designer-editing-dark');
});
