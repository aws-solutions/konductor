// SPDX-License-Identifier: Apache-2.0
import { DesignerPage } from './designer-page';
import { test as base } from './fixtures';
import { restoreSample } from './stub-workflow';

export { expect } from './fixtures';

/**
 * `test` for specs that save to the stub. The stub keeps what is saved until
 * it stops, so an automatic fixture puts the sample back before each test
 * opens the page, and after it.
 */
export const test = base.extend<{ sample: void; designer: DesignerPage }>({
  sample: [
    async ({ request }, use, testInfo) => {
      // The stub holds one workflow, so a second worker saving to it would
      // overwrite the first one's. Fail with the way out, not with a test
      // that flakes. The functional specs that use this fixture never save.
      if (testInfo.project.name === 'editing' && testInfo.parallelIndex !== 0) {
        throw new Error(
          'The editing tests share one stub, so they need one worker. Run them with --workers=1.',
        );
      }
      await restoreSample(request);
      await use();
      await restoreSample(request);
    },
    { auto: true },
  ],
  designer: async ({ canvas }, use) => {
    await canvas.expectWorkflowDrawn();
    await use(new DesignerPage(canvas.page));
  },
});
