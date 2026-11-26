// SPDX-License-Identifier: Apache-2.0
import type { Page } from '@playwright/test';
import { test as base, expect } from '../support/next-fixtures';
import { EDITING_PROJECT, STUB_LAUNCH_CODE } from '../../playwright.shared';
import { sharedSession } from '../support/session';
import { restoreSample } from '../support/stub-workflow';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

// This spec saves to the stub, which keeps one workflow, so it lives with the
// other saving specs: they run one after the other in one worker, after the
// specs that only read. The sample goes back before the page opens, so the
// text the page loads is the one these tests expect, and again after.
const test = base.extend<{ next: WorkflowCanvasPage }>({
  next: async ({ page, request }, use, testInfo) => {
    if (testInfo.project.name === EDITING_PROJECT && testInfo.parallelIndex) {
      throw new Error(
        'The saving tests share one stub, so they need one worker. Run them with --workers=1.',
      );
    }
    await restoreSample(request);
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    const canvas = new WorkflowCanvasPage(page);
    await page.goto(`/#${STUB_LAUNCH_CODE}`);
    await canvas.title.waitFor();
    await use(canvas);
    await restoreSample(request);
  },
});

const PROMPT = 'Write a warmer greeting to README.md.';

const promptField = (page: Page) =>
  page
    .getByRole('tabpanel', { name: 'Properties' })
    .getByLabel('prompt', { exact: true });

test('saves the prompt of a stage, which is still there after a reload', async ({
  next,
}) => {
  await next.page.getByRole('tab', { name: 'Properties' }).click();
  const prompt = promptField(next.page);
  await expect(prompt).toBeEditable();

  await prompt.fill(PROMPT);
  await expect(next.page.getByTestId('save-status')).toContainText(
    'Unsaved changes',
  );

  await next.page.getByRole('button', { name: 'Save' }).click();
  await expect(next.page.getByTestId('save-status')).toContainText('Saved');
  // The prompt reached the file, so the text shows it too.
  await expect(next.page.getByTestId('yaml-text')).toHaveValue(
    new RegExp(`prompt: ${PROMPT}`),
  );

  await next.page.reload();

  await next.page.getByRole('tab', { name: 'Properties' }).click();
  await expect(promptField(next.page)).toHaveValue(PROMPT);
});
