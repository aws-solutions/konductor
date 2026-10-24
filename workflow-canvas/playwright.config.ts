// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';
import { sharedConfig, stableRendering } from './playwright.shared';

// The default config, used by `npm run test:e2e`, a bare `npx playwright test`
// and editor integrations. It never includes the screenshot capture, so none
// of these can rewrite a committed file; see playwright.screenshots.config.ts.
export default defineConfig({
  ...sharedConfig,
  // A flaky test must fail the run, not pass on a retry.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'functional', testDir: 'e2e/tests', use: stableRendering },
  ],
});
