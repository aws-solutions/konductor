// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { textLines } from './text-lines';

const texts = (text: string) => textLines(text).map((line) => line.text);

describe('textLines', () => {
  it('numbers the lines from 1', () => {
    expect(textLines('a\nb')).toEqual([
      { n: 1, text: 'a' },
      { n: 2, text: 'b' },
    ]);
  });

  it.each([
    ['\\n', 'a\nb\nc'],
    ['\\r\\n', 'a\r\nb\r\nc'],
    ['a lone \\r', 'a\rb\rc'],
    ['a mix', 'a\r\nb\rc'],
  ])('ends a line at %s', (_, text) => {
    expect(texts(text)).toEqual(['a', 'b', 'c']);
  });

  it('starts no line after a break at the very end', () => {
    expect(texts('a\nb\n')).toEqual(['a', 'b']);
    expect(texts('a\r\n')).toEqual(['a']);
  });

  it('keeps blank lines, including one before the last break', () => {
    expect(texts('a\n\nb\n\n')).toEqual(['a', '', 'b', '']);
  });

  it('has no line for an empty text', () => {
    expect(textLines('')).toEqual([]);
  });
});
