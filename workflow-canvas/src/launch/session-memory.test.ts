// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../test-support/memory-storage';
import {
  PENDING_KEY,
  SESSION_KEY,
  sessionStorageMemory,
  type SessionRecord,
} from './session-memory';

const RECORD: SessionRecord = { token: 'token-1', harness: 'kiro-cli' };
const OTHER: SessionRecord = { token: 'token-2', harness: 'kiro-cli' };

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
    ['a record with an empty harness', '{"token":"token-1","harness":""}'],
    [
      'a record whose harness is not a string',
      '{"token":"token-1","harness":7}',
    ],
  ])('recalls nothing from %s', (_name, stored) => {
    const sessionStorage = memoryStorage();
    sessionStorage.setItem(SESSION_KEY, stored);

    expect(sessionStorageMemory({ sessionStorage }).recall()).toBeUndefined();
  });

  it.each(['kiro-cli', 'claude', 'fake', 'future-harness'])(
    'recalls a session of the harness %s, as it is',
    (harness) => {
      const memory = sessionStorageMemory({ sessionStorage: memoryStorage() });

      memory.remember({ token: 'token-1', harness });

      expect(memory.recall()).toEqual({ token: 'token-1', harness });
    },
  );

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
    expect(() => memory.holdPending(RECORD)).not.toThrow();
    expect(() => memory.dropPending()).not.toThrow();
    expect(memory.recall()).toBeUndefined();
    expect(memory.recallPending()).toBeUndefined();
  });
});

describe('sessionStorageMemory pending session', () => {
  function memoryWithBoth() {
    const sessionStorage = memoryStorage();
    const memory = sessionStorageMemory({ sessionStorage });
    memory.remember(RECORD);
    memory.holdPending(OTHER);
    return { memory, sessionStorage };
  }

  it('holds a session apart from the kept one, under its own key', () => {
    const { memory, sessionStorage } = memoryWithBoth();

    expect(memory.recall()).toEqual(RECORD);
    expect(memory.recallPending()).toEqual(OTHER);
    expect([...sessionStorage.entries.keys()].sort()).toEqual(
      [PENDING_KEY, SESSION_KEY].sort(),
    );
  });

  it('recalls nothing pending before a session is held', () => {
    expect(
      sessionStorageMemory({ sessionStorage: memoryStorage() }).recallPending(),
    ).toBeUndefined();
  });

  it('drops the pending session and leaves the kept one', () => {
    const { memory } = memoryWithBoth();

    memory.dropPending();

    expect(memory.recallPending()).toBeUndefined();
    expect(memory.recall()).toEqual(RECORD);
  });

  it('keeps the pending session when the kept one is forgotten', () => {
    const { memory } = memoryWithBoth();

    memory.forget();

    expect(memory.recall()).toBeUndefined();
    expect(memory.recallPending()).toEqual(OTHER);
  });

  it('keeps the pending session when the kept one is remembered again', () => {
    const memory = sessionStorageMemory({ sessionStorage: memoryStorage() });
    memory.remember(RECORD);
    memory.holdPending(OTHER);

    memory.remember(RECORD);

    expect(memory.recallPending()).toEqual(OTHER);
  });

  it('drops the pending session when another session is remembered', () => {
    const { memory } = memoryWithBoth();

    memory.remember({ token: 'token-3', harness: 'kiro-cli' });

    expect(memory.recallPending()).toBeUndefined();
  });

  it('recalls nothing pending from a record that is not valid', () => {
    const sessionStorage = memoryStorage();
    sessionStorage.setItem(PENDING_KEY, '{"token":""}');

    expect(sessionStorageMemory({ sessionStorage }).recallPending()).toBe(
      undefined,
    );
  });
});

describe('sessionStorageMemory storage scope', () => {
  it('never writes the session to localStorage', () => {
    window.localStorage.clear();
    const memory = sessionStorageMemory({
      sessionStorage: window.sessionStorage,
    });

    memory.remember(RECORD);
    memory.holdPending(OTHER);
    memory.forget();
    memory.dropPending();

    expect(window.localStorage.length).toBe(0);
  });

  it('leaves nothing in the tab storage after forget and dropPending', () => {
    window.sessionStorage.clear();
    const memory = sessionStorageMemory({
      sessionStorage: window.sessionStorage,
    });
    memory.remember(RECORD);
    memory.holdPending(OTHER);

    memory.forget();
    memory.dropPending();

    expect(window.sessionStorage.length).toBe(0);
  });
});
