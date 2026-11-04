// SPDX-License-Identifier: Apache-2.0
import { test as base } from '@playwright/test';
import { STUB_LAUNCH_CODE } from '../../playwright.shared';
import { sharedSession } from './session';
import { WorkflowCanvasPage } from './workflow-canvas-page';

export { expect } from '@playwright/test';

/**
 * `test` extended with a `canvas` page object that has already opened the
 * app with the launch code of the config.
 *
 * A launch code works once, and the global setup has used it. So the page's
 * own `POST /api/session` is answered with that session; every other call
 * goes to the API for real.
 */
export const test = base.extend<{ canvas: WorkflowCanvasPage }>({
  canvas: async ({ page }, use) => {
    await page.route('**/api/session', (route) =>
      route.fulfill({ json: sharedSession() }),
    );
    const canvas = new WorkflowCanvasPage(page);
    await canvas.open(STUB_LAUNCH_CODE);
    await use(canvas);
  },
});
