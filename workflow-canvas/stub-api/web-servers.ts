// SPDX-License-Identifier: Apache-2.0
import type { PlaywrightTestConfig } from '@playwright/test';
import { DEFAULT_APP_PORT, LOOPBACK, originOf, portOf } from './address.ts';
import type { ApiTarget } from './target.ts';

/** The servers Playwright starts. This module reads no environment. */
export type WebServer = Extract<
  PlaywrightTestConfig['webServer'],
  { command: string }
>;

/** A real server must be started with this launch code. */
export const STUB_LAUNCH_CODE = 'e2e-launch-code-0123456789';

const appServer = (port: number): WebServer => ({
  name: 'app',
  command: `npm run build && npx vite preview --host ${LOOPBACK} --port ${port} --strictPort`,
  url: originOf(port),
  reuseExistingServer: false,
  timeout: 120_000,
});

// `--with-dev-server` lets a test open the page again with the same launch
// code, as `dev:stub` does for a person who reloads the page.
const stubServer = (target: ApiTarget): WebServer => ({
  name: 'stub-api',
  command: 'npm run stub -- --with-dev-server',
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
 * target; a real server is started by whoever set `WC_API_TARGET`. The app
 * listens on `appPort`.
 */
export function webServersFor(
  target: ApiTarget,
  appPort: number = DEFAULT_APP_PORT,
): WebServer[] {
  const app = appServer(appPort);
  return target.isStub ? [app, stubServer(target)] : [app];
}
