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

const isTable = (value: unknown): value is object =>
  Array.isArray(value) || ArrayBuffer.isView(value);

/**
 * Replaces every array and typed array held by `owner` with a view that counts
 * its index reads, and returns the counter. A method call on a table is charged
 * its whole length. It works whatever the tables are called or made of, so a
 * lookup that walks any of them is seen. Use it after the owner is built.
 */
export function countTableReads(owner: object): { reads: number } {
  const counter = { reads: 0 };
  for (const [name, value] of Object.entries(owner)) {
    if (!isTable(value)) continue;
    const length = () => (value as ArrayLike<unknown>).length;
    (owner as Record<string, unknown>)[name] = new Proxy(value, {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) counter.reads++;
        const found: unknown = Reflect.get(target, key);
        if (typeof found !== 'function') return found;
        return (...args: unknown[]) => {
          counter.reads += length();
          return found.apply(target, args);
        };
      },
    });
  }
  return counter;
}
