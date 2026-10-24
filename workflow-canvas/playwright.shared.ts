// SPDX-License-Identifier: Apache-2.0
import {
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test';
import { LOOPBACK, originOf, portOf } from './stub-api/address';
import { apiTargetOrExit, type ApiTarget } from './stub-api/target';

type WebServer = Extract<
  PlaywrightTestConfig['webServer'],
  { command: string }
>;

const HOST = LOOPBACK;
const APP_PORT = 4173;
const APP_URL = originOf(APP_PORT);

/**
 * Where the API listens during a run: the stub, or the server named by
 * `WC_API_TARGET`. A real server must be started with this launch code.
 */
export const API_TARGET = apiTargetOrExit();
export const API_URL = API_TARGET.origin;
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

const appServer: WebServer = {
  name: 'app',
  command: `npm run build && npx vite preview --host ${HOST} --port ${APP_PORT} --strictPort`,
  url: APP_URL,
  reuseExistingServer: false,
  timeout: 120_000,
};

const stubServer = (target: ApiTarget): WebServer => ({
  name: 'stub-api',
  command: 'npm run stub',
  env: {
    STUB_PORT: String(portOf(target.origin)),
    STUB_LAUNCH_CODE,
  },
  // The stub answers 401 here until a session exists, which counts as up.
  url: `${target.origin}/api/workflow`,
  reuseExistingServer: false,
  timeout: 30_000,
});

/**
 * The servers a run depends on, started before and stopped after it. The app
 * is served from a production build. The stub API starts after the app build,
 * because its launch code works for 60 seconds. It starts only when it is the
 * target; a real server is started by whoever set `WC_API_TARGET`.
 */
export function webServersFor(target: ApiTarget): WebServer[] {
  return target.isStub ? [appServer, stubServer(target)] : [appServer];
}

/** Settings shared by the functional run and the screenshot capture. */
export const sharedConfig: PlaywrightTestConfig = {
  outputDir: 'test-results',
  forbidOnly: Boolean(process.env.CI),
  // A flaky test must fail the run, not pass on a retry.
  retries: 0,
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
  webServer: webServersFor(API_TARGET),
};
