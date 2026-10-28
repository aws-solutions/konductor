// SPDX-License-Identifier: Apache-2.0
import { expect } from '@playwright/test';
import { API_TARGET, STUB_LAUNCH_CODE } from '../../playwright.shared';
import { test } from '../support/fixtures';
import { WorkflowCanvasPage } from '../support/workflow-canvas-page';

// A reload would ask the server for the page again. A request made after the
// anchor was set is answered after any reload request, so once it is answered
// the page is known not to have reloaded.
test('keeps the workflow on the page when the address gets an anchor', async ({
  canvas,
  page,
}) => {
  const pageRequests: string[] = [];
  await page.route('**/barrier', (route) => route.fulfill({ body: 'ok' }));
  page.on('request', (request) => {
    if (request.isNavigationRequest()) pageRequests.push(request.url());
  });

  await page.evaluate(async () => {
    window.location.hash = '#some-anchor';
    await fetch('/barrier');
  });

  expect(pageRequests).toEqual([]);
  await canvas.expectWorkflowDrawn();
  await expect(page.getByText('The workflow did not load')).toHaveCount(0);
});

// A reload drops the token and the launch code from the page, so the person
// opens the printed address again. The stub takes the code again for that; a
// server that follows the contract to the letter does not, so these tests run
// against the stub only. The page makes its own `POST /api/session` here.
if (API_TARGET.isStub) {
  test('opens the workflow again when the launch address is opened after a reload', async ({
    page,
  }) => {
    const canvas = new WorkflowCanvasPage(page);
    await canvas.open(STUB_LAUNCH_CODE);
    await canvas.expectWorkflowDrawn();

    await page.reload();
    await expect(page.getByText(/no launch code in the address/)).toBeVisible();

    // Pasting the printed address into the same tab only changes the fragment.
    await canvas.open(STUB_LAUNCH_CODE);

    await expect(page.getByText('The workflow did not load')).toHaveCount(0);
    await canvas.expectWorkflowDrawn();
  });
}
