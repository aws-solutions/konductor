// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { sessionRunMemory } from './run-memory';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const denied = () => {
  throw new Error('Access is denied.');
};
// A browser that blocks storage throws on reading the property already.
const blockedAtAccess = {
  get sessionStorage(): never {
    return denied();
  },
};
const blockedAtUse = { sessionStorage: { getItem: denied, setItem: denied } };

describe('sessionRunMemory', () => {
  it('recalls nothing before a run is remembered', () => {
    expect(
      sessionRunMemory({ sessionStorage: memoryStorage() }).recall(),
    ).toBeUndefined();
  });

  it('recalls the run that was remembered, also through another memory of the same storage', () => {
    const env = { sessionStorage: memoryStorage() };
    sessionRunMemory(env).remember('run-1');

    expect(sessionRunMemory(env).recall()).toBe('run-1');
  });

  it('keeps only the latest run', () => {
    const memory = sessionRunMemory({ sessionStorage: memoryStorage() });
    memory.remember('run-1');
    memory.remember('run-2');

    expect(memory.recall()).toBe('run-2');
  });

  it('treats an empty value as nothing', () => {
    const storage = memoryStorage();
    storage.setItem('konductor-workflow-canvas-run', '');

    expect(
      sessionRunMemory({ sessionStorage: storage }).recall(),
    ).toBeUndefined();
  });

  it('works without storage, or with storage that the browser blocks', () => {
    for (const env of [{}, blockedAtAccess, blockedAtUse]) {
      const memory = sessionRunMemory(env);
      expect(() => memory.remember('run-1')).not.toThrow();
      expect(memory.recall()).toBeUndefined();
    }
  });
});
