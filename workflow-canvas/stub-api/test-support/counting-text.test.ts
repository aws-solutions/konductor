// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { countingText } from './counting-text.ts';

const TEXT = 'hello world';

describe('countingText', () => {
  it.each<[string, (text: string) => unknown, number]>([
    ['charCodeAt', (t) => t.charCodeAt(1), 1],
    ['codePointAt', (t) => t.codePointAt(1), 1],
    ['at', (t) => t.at(-1), 1],
    ['charAt', (t) => t.charAt(1), 1],
    ['an index', (t) => t[3], 1],
    ['slice', (t) => t.slice(2, 7), 5],
    ['substring', (t) => t.substring(2, 7), 5],
    ['substr', (t) => t.substr(2, 5), 5],
    ['indexOf that finds', (t) => t.indexOf('o'), 5],
    ['indexOf that does not', (t) => t.indexOf('zz'), 11],
    ['includes', (t) => t.includes('wor'), 9],
    ['lastIndexOf', (t) => t.lastIndexOf('o'), 5],
    ['split', (t) => t.split(' '), 11],
    ['iteration', (t) => [...t], 11],
    ['a method that is not named', (t) => t.startsWith('he'), 11],
  ])('charges %s what it reads', (_, read, expected) => {
    const { counted, wrapped } = countingText(TEXT);
    read(wrapped);
    expect(counted.reads).toBe(expected);
  });

  it('reads the text it wraps', () => {
    const { wrapped } = countingText(TEXT);
    expect(wrapped.length).toBe(TEXT.length);
    expect(wrapped.slice(0, 5)).toBe('hello');
  });
});
