// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { webServersFor } from '../playwright.shared.ts';
import { originOf } from './address.ts';
import { apiTarget } from './target.ts';

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
});
