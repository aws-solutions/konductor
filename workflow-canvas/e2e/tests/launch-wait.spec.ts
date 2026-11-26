// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { sharedSession } from '../support/session';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

// The server takes the launch code and never answers.
async function openAgainstSilentServer(page: Page) {
  await page.clock.install();
  await page.route('**/api/session', () => new Promise(() => {}));
  await page.goto(`/#${STUB_LAUNCH_CODE}`);
}

test('says it is still waiting, and stopping ends in an error that names the next step', async ({
  page,
}) => {
  await openAgainstSilentServer(page);
  await expect(page.getByText('Loading the workflow')).toBeVisible();
  await expect(page.getByTestId('launch-wait')).toHaveCount(0);

  await page.clock.fastForward(5_000);
  await expect(page.getByTestId('launch-wait')).toContainText(
    'Still waiting for the server',
  );
  await page.getByRole('button', { name: 'Stop waiting' }).click();

  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await expect(page.getByText(/may have used the launch code/)).toBeVisible();
  await expect(page.getByTestId('launch-wait')).toHaveCount(0);
});

test('ends in the same error at the hard limit', async ({ page }) => {
  await openAgainstSilentServer(page);

  await page.clock.fastForward(121_000);

  await expect(page.getByText('The workflow did not load')).toBeVisible();
  await expect(page.getByText(/may have used it/)).toBeVisible();
});

test('opens the workflow when the answer comes after the notice', async ({
  page,
}) => {
  await page.clock.install();
  let answer: () => void = () => {};
  await page.route(
    '**/api/session',
    (route) =>
      new Promise<void>((resolve) => {
        answer = () => {
          void route.fulfill({ json: sharedSession() }).then(resolve);
        };
      }),
  );
  await page.goto(`/#${STUB_LAUNCH_CODE}`);
  await page.clock.fastForward(5_000);
  await expect(page.getByTestId('launch-wait')).toBeVisible();

  answer();

  const canvas = new WorkflowCanvasPage(page);
  await canvas.expectWorkflowDrawn();
  await expect(page.getByTestId('launch-wait')).toHaveCount(0);
});
