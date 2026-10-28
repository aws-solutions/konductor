// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  isLaunchCode,
  watchLaunchCode,
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

describe('watchLaunchCode', () => {
  const CODE = 'q3x7vJ2kLmN9pRs4TuVw5Y_-ab12';

  function watched(hash: string) {
    const listeners = new Set<() => void>();
    const env = {
      ...environment(hash),
      addEventListener: (_type: 'hashchange', listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'hashchange', listener: () => void) => {
        listeners.delete(listener);
      },
    };
    const onCode = vi.fn();
    const stop = watchLaunchCode(env, onCode);
    return {
      env,
      onCode,
      stop,
      listeners,
      changeHash: () => listeners.forEach((l) => l()),
    };
  }

  it('hands over a launch code that is put into the address, and clears it', () => {
    const { env, onCode, changeHash } = watched(`#${CODE}`);

    changeHash();

    expect(onCode).toHaveBeenCalledExactlyOnceWith(CODE);
    expect(env.history.replaceState).toHaveBeenCalledOnce();
  });

  it('does nothing when the fragment is empty', () => {
    const { env, onCode, changeHash } = watched('#');

    changeHash();

    expect(onCode).not.toHaveBeenCalled();
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it.each(['#some-anchor', '#top', '#section-2', '#abc-123'])(
    'leaves %s alone, which is not a launch code',
    (hash) => {
      const { env, onCode, changeHash } = watched(hash);

      changeHash();

      expect(onCode).not.toHaveBeenCalled();
      expect(env.history.replaceState).not.toHaveBeenCalled();
    },
  );

  it('leaves a fragment that is too long to be a code alone', () => {
    const { onCode, changeHash } = watched(`#${'a'.repeat(257)}`);

    changeHash();

    expect(onCode).not.toHaveBeenCalled();
  });

  it('stops watching when the returned function is called', () => {
    const { onCode, stop, listeners, changeHash } = watched(`#${CODE}`);

    stop();
    changeHash();

    expect(listeners.size).toBe(0);
    expect(onCode).not.toHaveBeenCalled();
  });
});

describe('isLaunchCode', () => {
  it.each([
    ['a base64url code of 32 bytes', 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MDEyMzQ1Ng'],
    ['a hex code of 16 bytes', '0123456789abcdef0123456789abcdef'],
    ['the shortest code of 16 characters', 'a'.repeat(16)],
    ['the longest code of 256 characters', 'a'.repeat(256)],
    ['the code of the API example', 'EXAMPLE-LAUNCH-CODE'],
    ['standard base64 with + / =', 'ab+cd/ef12GH34ij56kl78=='],
    ['a code with dots and tildes', 'abc.def~ghi.jkl~mno.pqr'],
  ])('accepts %s', (_, code) => {
    expect(isLaunchCode(code)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['15 characters', 'a'.repeat(15)],
    ['257 characters', 'a'.repeat(257)],
    ['a word with a space', 'some anchor with a space inside'],
    ['a tab inside', `${'a'.repeat(10)}\t${'b'.repeat(10)}`],
  ])('rejects %s', (_, code) => {
    expect(isLaunchCode(code)).toBe(false);
  });
});
