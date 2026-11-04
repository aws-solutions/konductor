// SPDX-License-Identifier: Apache-2.0
import {
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test';
import { appPort, originOf } from './stub-api/address';
import { exitOnConfigError } from './stub-api/config-error';
import { apiTargetOrExit } from './stub-api/target';
import { STUB_LAUNCH_CODE, webServersFor } from './stub-api/web-servers';

export { STUB_LAUNCH_CODE };

/**
 * Where the built page is served: `WC_APP_PORT`, or 4173. This is the only
 * place that reads the variable.
 */
export const APP_PORT = exitOnConfigError(() => appPort());
export const APP_URL = originOf(APP_PORT);

/**
 * Where the API listens during a run: the stub, or the server named by
 * `WC_API_TARGET`. This is the only place that reads the variable for
 * Playwright; the server definitions are in `stub-api/web-servers.ts`.
 */
export const API_TARGET = apiTargetOrExit();
export const API_URL = API_TARGET.origin;

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

/** The name of the project whose tests save to the stub, one at a time. */
export const EDITING_PROJECT = 'editing';

/** Settings shared by the functional run and the screenshot capture. */
export const sharedConfig: PlaywrightTestConfig = {
  outputDir: 'test-results',
  // Opens the session that the tests share, once the servers are up.
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: Boolean(process.env.CI),
  // A flaky test must fail the run, not pass on a retry.
  retries: 0,
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
  webServer: webServersFor(API_TARGET, APP_PORT),
};
