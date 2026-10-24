// SPDX-License-Identifier: Apache-2.0
import {
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test';
import { DEFAULT_PORT, LOOPBACK, originOf } from './stub-api/address';

const HOST = LOOPBACK;
const APP_PORT = 4173;
const APP_URL = originOf(APP_PORT);

/** Where the stub API listens during a run, and the launch code it accepts. */
export const STUB_PORT = DEFAULT_PORT;
export const STUB_URL = originOf(STUB_PORT);
export const STUB_LAUNCH_CODE = 'e2e-launch-code';

/**
 * One viewport and render mode for every project. With the pinned font and the
 * text flags below, a screenshot differs between runs only when the UI does.
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
  // The app is served from a production build. The stub API starts after the
  // app build, because its launch code works for 60 seconds. No page calls it.
  webServer: [
    {
      name: 'app',
      command: `npm run build && npx vite preview --host ${HOST} --port ${APP_PORT} --strictPort`,
      url: APP_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'stub-api',
      command: 'npm run stub',
      env: {
        STUB_PORT: String(STUB_PORT),
        STUB_LAUNCH_CODE,
      },
      // The stub answers 401 here until a session exists, which counts as up.
      url: `${STUB_URL}/api/workflow`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
};
