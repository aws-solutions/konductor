// SPDX-License-Identifier: Apache-2.0
import {
  sessionStorageMemory,
  type SessionMemory,
} from '../launch/session-memory';

/** The storage calls that the page makes, over a map that a test can read. */
export type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A storage kept in a map, for a test of what the page writes to it. */
export function memoryStorage(): TabStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

/** A session memory over a fresh storage, for a test that is not about it. */
export function freshMemory(): SessionMemory {
  return sessionStorageMemory({ sessionStorage: memoryStorage() });
}
