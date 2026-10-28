// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../test-support/memory-storage';
import { SESSION_KEY, sessionStorageMemory } from './session-memory';

const RECORD = { token: 'token-1', harness: 'kiro-cli' };

describe('sessionStorageMemory', () => {
  it('recalls nothing before anything is remembered', () => {
    const memory = sessionStorageMemory({ sessionStorage: memoryStorage() });

    expect(memory.recall()).toBeUndefined();
  });

  it('recalls the session it remembered, from the tab storage', () => {
    const sessionStorage = memoryStorage();

    sessionStorageMemory({ sessionStorage }).remember(RECORD);

    expect(sessionStorage.entries.size).toBe(1);
    expect(sessionStorageMemory({ sessionStorage }).recall()).toEqual(RECORD);
  });

  it('keeps the session under one named key', () => {
    const sessionStorage = memoryStorage();

    sessionStorageMemory({ sessionStorage }).remember(RECORD);

    expect([...sessionStorage.entries.keys()]).toEqual([SESSION_KEY]);
  });

  it('forgets the session', () => {
    const sessionStorage = memoryStorage();
    const memory = sessionStorageMemory({ sessionStorage });
    memory.remember(RECORD);

    memory.forget();

    expect(memory.recall()).toBeUndefined();
    expect(sessionStorage.entries.size).toBe(0);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '"token-1"'],
    ['a record with no token', '{"harness":"kiro-cli"}'],
    ['a record with an empty token', '{"token":"","harness":"kiro-cli"}'],
    ['a record with no harness', '{"token":"token-1"}'],
  ])('recalls nothing from %s', (_name, stored) => {
    const sessionStorage = memoryStorage();
    sessionStorage.setItem(SESSION_KEY, stored);

    expect(sessionStorageMemory({ sessionStorage }).recall()).toBeUndefined();
  });

  it('keeps nothing in a page with no storage', () => {
    const memory = sessionStorageMemory({});

    memory.remember(RECORD);
    memory.forget();

    expect(memory.recall()).toBeUndefined();
  });

  it('ignores a storage that throws', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const memory = sessionStorageMemory({ sessionStorage: blocked });

    expect(() => memory.remember(RECORD)).not.toThrow();
    expect(() => memory.forget()).not.toThrow();
    expect(memory.recall()).toBeUndefined();
  });
});
