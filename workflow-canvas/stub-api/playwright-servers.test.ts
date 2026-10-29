// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('start the stub as the contract has it, with a launch code that works once', () => {
    const [, stub] = webServersFor(apiTarget({}));
    expect(stub?.command).not.toContain('--with-dev-server');
  });

  it('serve the app on 4173 unless told another port', () => {
    const [app] = webServersFor(apiTarget({}));
    expect(app?.url).toBe(originOf(4173));
    expect(app?.command).toContain('--port 4173 ');

    const [other] = webServersFor(apiTarget({}), 4300);
    expect(other?.url).toBe(originOf(4300));
    expect(other?.command).toContain('--port 4300 ');
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

  it('serves the app on WC_APP_PORT', async () => {
    const shared = await loadShared({
      WC_API_TARGET: undefined,
      WC_APP_PORT: '4300',
    });

    expect(shared.APP_URL).toBe(originOf(4300));
    expect(shared.sharedConfig.use?.baseURL).toBe(originOf(4300));
    expect(shared.sharedConfig.webServer).toMatchObject([
      { name: 'app', url: originOf(4300) },
      { name: 'stub-api' },
    ]);
  });

  it('serves the app on 4173 when WC_APP_PORT is unset', async () => {
    const shared = await loadShared({ WC_APP_PORT: undefined });

    expect(shared.APP_URL).toBe(originOf(4173));
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
