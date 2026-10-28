// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  reloadOnLaunchCode,
  takeLaunchCode,
  type LaunchEnvironment,
} from './launch-code';

function environment(hash: string, search = ''): LaunchEnvironment {
  return {
    location: { hash, pathname: '/app/', search },
    history: { replaceState: vi.fn() },
  };
}

describe('takeLaunchCode', () => {
  it('returns the code that follows the hash', () => {
    expect(takeLaunchCode(environment('#abc-123'))).toBe('abc-123');
  });

  it('removes the fragment from the address and keeps path and query', () => {
    const env = environment('#abc', '?x=1');

    takeLaunchCode(env);

    expect(env.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/app/?x=1',
    );
  });

  it('returns undefined and leaves the address alone without a fragment', () => {
    const env = environment('');

    expect(takeLaunchCode(env)).toBeUndefined();
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it('returns undefined for an empty fragment and still clears it', () => {
    const env = environment('#');

    expect(takeLaunchCode(env)).toBeUndefined();
    expect(env.history.replaceState).toHaveBeenCalledOnce();
  });

  it('decodes a percent-encoded code', () => {
    expect(takeLaunchCode(environment('#a%20b'))).toBe('a b');
  });

  it('keeps a code that is not valid percent-encoding as it is', () => {
    expect(takeLaunchCode(environment('#100%'))).toBe('100%');
  });
});

describe('reloadOnLaunchCode', () => {
  function watched(hash: string) {
    const listeners: Array<() => void> = [];
    const env = {
      location: { hash, reload: vi.fn() },
      addEventListener: (_type: 'hashchange', listener: () => void) => {
        listeners.push(listener);
      },
    };
    reloadOnLaunchCode(env);
    return { env, changeHash: () => listeners.forEach((l) => l()) };
  }

  it('reloads the page when a launch code is put into the address', () => {
    const { env, changeHash } = watched('#abc-123');

    changeHash();

    expect(env.location.reload).toHaveBeenCalledOnce();
  });

  it('does not reload when the fragment is empty', () => {
    const { env, changeHash } = watched('#');

    changeHash();

    expect(env.location.reload).not.toHaveBeenCalled();
  });
});
