// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { inlineScriptOf, inlineScriptsOf } from './inline-script.ts';

describe('inlineScriptOf', () => {
  it.each([
    ['a plain tag', '<script>a()</script>'],
    [
      'an upper case tag with an attribute',
      '<SCRIPT type="module">a()</SCRIPT>',
    ],
    ['an end tag with a space', '<script>a()</script >'],
    ['an end tag with an attribute', '<script>a()</script foo="bar">'],
    ['a start tag with a space', '<script >a()</script>'],
  ])('finds the body in %s', (_, html) => {
    expect(inlineScriptOf(html)).toBe('a()');
  });

  it('skips a script with no body, such as one that loads a file', () => {
    expect(
      inlineScriptOf(
        '<script type="module" src="/x.js"></script><script>b()</script>',
      ),
    ).toBe('b()');
  });

  it('does not take a tag whose name only starts with script', () => {
    expect(inlineScriptOf('<scripture>a()</scripture>')).toBe('');
  });

  it('is empty when there is no script', () => {
    expect(inlineScriptOf('<p>none</p>')).toBe('');
  });
});

describe('inlineScriptsOf', () => {
  it('lists every inline script in order, and skips one that loads a file', () => {
    expect(
      inlineScriptsOf(
        '<script>a()</script><script src="/x.js"></script><script>b()</script>',
      ),
    ).toEqual(['a()', 'b()']);
  });

  it('is empty when there is no inline script', () => {
    expect(inlineScriptsOf('<script src="/x.js"></script>')).toEqual([]);
  });
});
