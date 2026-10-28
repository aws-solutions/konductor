// SPDX-License-Identifier: Apache-2.0

/**
 * Runs `run` while every `Uint32Array` it creates counts its index reads, so a
 * test can bound the table work of code that never reads the text itself. Keep
 * the work inside `run` small: anything else that reads such an array in that
 * window is counted too.
 */
export function withCountedUint32Arrays<T>(
  run: (counter: { reads: number }) => T,
): T {
  const counter = { reads: 0 };
  const Real = globalThis.Uint32Array;

  class Counted {
    constructor(length: number) {
      return new Proxy(new Real(length), {
        get(target, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) counter.reads++;
          const value: unknown = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }
  }

  globalThis.Uint32Array = Counted as unknown as Uint32ArrayConstructor;
  try {
    return run(counter);
  } finally {
    globalThis.Uint32Array = Real;
  }
}
