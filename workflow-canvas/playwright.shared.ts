// SPDX-License-Identifier: Apache-2.0
import {
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test';

const HOST = '127.0.0.1';
const APP_PORT = 4173;
const APP_URL = `http://${HOST}:${APP_PORT}`;

/**
 * One viewport and one render mode for every project. Combined with the pinned
 * font that the screenshot helper loads and the text rasterisation flags below,
 * a screenshot differs between runs and machines only when the UI does.
 */
export const stableRendering: NonNullable<Project['use']> = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
  // Rasterise text without host-specific hinting or subpixel (LCD) smoothing.
  launchOptions: {
    args: ['--font-render-hinting=none', '--disable-lcd-text'],
  },
};

/** Settings shared by the functional run and the screenshot capture. */
export const sharedConfig: PlaywrightTestConfig = {
  outputDir: 'test-results',
  forbidOnly: Boolean(process.env.CI),
  // A flaky test must fail the run, not pass on a retry.
  retries: 0,
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
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
};
