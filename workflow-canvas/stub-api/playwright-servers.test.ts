// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
// Loaded here so its cold start is not charged to the first timed test below.
// It reads no environment, and the module cache survives `vi.resetModules()`.
import '@playwright/test';
import { originOf } from './address.ts';
import { apiTarget } from './target.ts';
import { webServersFor } from './web-servers.ts';

const names = (env: NodeJS.ProcessEnv) =>
  webServersFor(apiTarget(env)).map((server) => server.name);

describe('the Playwright web servers', () => {
  it('start the app and the stub when no target is set', () => {
    expect(names({})).toEqual(['app', 'stub-api']);
  });

  it('start only the app when a target is set', () => {
    expect(names({ WC_API_TARGET: 'http://127.0.0.1:8080' })).toEqual(['app']);
  });

  it('wait for the stub at the port it listens on', () => {
    const [, stub] = webServersFor(apiTarget({ STUB_PORT: '6000' }));
    expect(stub).toMatchObject({
      url: `${originOf(6000)}/api/workflow`,
      env: { STUB_PORT: '6000' },
    });
  });

  it('give the stub port 80 as 80, not as an empty port', () => {
    const [, stub] = webServersFor(apiTarget({ STUB_PORT: '80' }));
    expect(stub).toMatchObject({
      url: 'http://127.0.0.1/api/workflow',
      env: { STUB_PORT: '80' },
    });
  });
});

// `playwright.shared.ts` reads the environment when it loads, so it is imported
// only here, after the test has set the environment. The static imports above
// read none, which keeps a mistyped shell variable from failing `npm test`.
describe('the shared Playwright config, read from the environment', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Loads `playwright.shared.ts` fresh, as Playwright does, with `env` set. */
  async function loadShared(env: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.resetModules();
    return import('../playwright.shared.ts');
  }

  const serverNames = (webServer: unknown): string[] =>
    (webServer as Array<{ name: string }>).map((server) => server.name);

  it('starts the stub when WC_API_TARGET is unset', async () => {
    const shared = await loadShared({
      WC_API_TARGET: undefined,
      STUB_PORT: undefined,
    });

    expect(serverNames(shared.sharedConfig.webServer)).toEqual([
      'app',
      'stub-api',
    ]);
    expect(shared.API_URL).toBe(originOf(5174));
  });

  it('skips the stub and tests the named server when WC_API_TARGET is set', async () => {
    const shared = await loadShared({
      WC_API_TARGET: 'http://127.0.0.1:8080',
      STUB_PORT: undefined,
    });

    expect(serverNames(shared.sharedConfig.webServer)).toEqual(['app']);
    expect(shared.API_URL).toBe('http://127.0.0.1:8080');
  });
});
