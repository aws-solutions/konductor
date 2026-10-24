// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';
import { sharedConfig, stableRendering } from './playwright.shared';

// Used only by `npm run screenshots`, which rewrites the PNGs under
// e2e/screenshots/. The list reporter leaves the functional run's HTML report
// alone.
export default defineConfig({
  ...sharedConfig,
  reporter: 'list',
  projects: [
    { name: 'screenshots', testDir: 'e2e/capture', use: stableRendering },
  ],
});
