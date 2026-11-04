// SPDX-License-Identifier: Apache-2.0
import { DesignerPage } from './designer-page';
import { test as base } from './fixtures';

export { expect } from './fixtures';

/** `test` for specs that edit on the Designer tab. */
export const test = base.extend<{ designer: DesignerPage }>({
  designer: async ({ canvas }, use) => {
    await canvas.expectWorkflowDrawn();
    await use(new DesignerPage(canvas.page));
  },
});
