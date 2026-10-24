// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const HOST = '127.0.0.1';
const APP_PORT = 4173;
const APP_URL = `http://${HOST}:${APP_PORT}`;
const isCI = Boolean(process.env.CI);

// One viewport and one render mode for every project, so a screenshot differs
// between runs only when the UI does.
const stableRendering = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
} as const;

export default defineConfig({
  outputDir: 'test-results',
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
  projects: [
    // `npm run test:e2e`
    { name: 'functional', testDir: 'e2e/tests', use: stableRendering },
    // `npm run screenshots`: rewrites the PNGs under e2e/screenshots/.
    { name: 'screenshots', testDir: 'e2e/capture', use: stableRendering },
  ],
  // Servers the tests depend on, started before and stopped after the run.
  // The app is served from a production build, as users get it. A backing
  // service the app calls gets its own entry here, so one command starts
  // everything.
  webServer: [
    {
      name: 'app',
      command: `npm run build && npx vite preview --host ${HOST} --port ${APP_PORT} --strictPort`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
