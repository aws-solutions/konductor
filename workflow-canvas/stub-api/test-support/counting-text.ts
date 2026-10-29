// SPDX-License-Identifier: Apache-2.0

type Method = (...args: unknown[]) => unknown;

const ONE_CHARACTER = new Set(['charCodeAt', 'codePointAt', 'at', 'charAt']);
const SUBSTRING = new Set(['slice', 'substring', 'substr']);
const SEARCH = new Set(['indexOf', 'includes']);

/**
 * A string that counts how much of it is read, so a test can bound the work of
 * code that takes text without timing it. Every read is charged what it costs:
 * one for a character, the length returned for a substring, the length scanned
 * for a search, and the whole length for `split`, iteration and any method not
 * named here. The wrapper stands in for a string where the code under test only
 * reads it, so it must not be passed to code that needs a primitive.
 */
export function countingText(text: string) {
  const counted = { reads: 0 };
  const charge = (units: number) => {
    counted.reads += units;
  };
  const original = text as unknown as Record<string, Method>;

  const methodCost = (name: string, args: unknown[], result: unknown) => {
    if (ONE_CHARACTER.has(name)) return 1;
    if (SUBSTRING.has(name)) return String(result).length;
    if (SEARCH.has(name)) return scannedForward(args);
    if (name === 'lastIndexOf') return scannedBackward(args);
    return text.length;
  };

  const scannedForward = ([needle, from]: unknown[]) => {
    const start = clamp(Number(from ?? 0));
    const found = text.indexOf(String(needle), start);
    return found < 0
      ? text.length - start
      : found - start + String(needle).length;
  };

  const scannedBackward = ([needle, from]: unknown[]) => {
    const start = from === undefined ? text.length : clamp(Number(from));
    const found = text.lastIndexOf(String(needle), start);
    return found < 0
      ? Math.min(text.length, start + String(needle).length)
      : start - found + String(needle).length;
  };

  const clamp = (at: number) =>
    Number.isNaN(at) ? 0 : Math.min(Math.max(at, 0), text.length);

  const wrapped = new Proxy(new String(text), {
    get(target, key) {
      if (key === 'length') return text.length;
      if (key === Symbol.iterator) return characters;
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        charge(1);
        return text[Number(key)];
      }
      if (typeof key === 'string' && typeof original[key] === 'function') {
        return (...args: unknown[]) => {
          const result = original[key]?.(...args);
          charge(methodCost(key, args, result));
          return result;
        };
      }
      return Reflect.get(target, key);
    },
  }) as unknown as string;

  function* characters() {
    for (const character of text) {
      charge(1);
      yield character;
    }
  }

  return { counted, wrapped };
}
