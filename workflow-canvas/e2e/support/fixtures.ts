// SPDX-License-Identifier: Apache-2.0
import { test as base } from '@playwright/test';
import { WorkflowCanvasPage } from './workflow-canvas-page';

export { expect } from '@playwright/test';

/** `test` extended with a `canvas` page object that has already opened the app. */
export const test = base.extend<{ canvas: WorkflowCanvasPage }>({
  canvas: async ({ page }, use) => {
    const canvas = new WorkflowCanvasPage(page);
    await canvas.open();
    await use(canvas);
  },
});
