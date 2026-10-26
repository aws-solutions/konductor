// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';
import { sharedConfig, stableRendering } from './playwright.shared';

// The default config, used by `npm run test:e2e`, a bare `npx playwright test`
// and editor integrations. It never includes the screenshot capture, so none
// of these can rewrite a committed file; see playwright.screenshots.config.ts.
export default defineConfig({
  ...sharedConfig,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'functional', testDir: 'e2e/tests', use: stableRendering },
    // These save to the stub, which keeps one workflow for all of them, so
    // they run after the others, which only read it.
    {
      name: 'editing',
      testDir: 'e2e/editing',
      use: stableRendering,
      dependencies: ['functional'],
    },
  ],
});
