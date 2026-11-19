// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { AT_END_PX, endScrollTop, isAtEnd } from './follow-end';

const box = (scrollTop: number) => ({
  scrollTop,
  scrollHeight: 1000,
  clientHeight: 300,
});

describe('isAtEnd', () => {
  it('is true at the bottom and within the threshold of it', () => {
    expect(isAtEnd(box(700))).toBe(true);
    expect(isAtEnd(box(700 - AT_END_PX))).toBe(true);
  });

  it('is false once the box is scrolled up past the threshold', () => {
    expect(isAtEnd(box(700 - AT_END_PX - 1))).toBe(false);
    expect(isAtEnd(box(0))).toBe(false);
  });

  it('is true for a box that does not scroll', () => {
    expect(
      isAtEnd({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }),
    ).toBe(true);
  });
});

describe('endScrollTop', () => {
  it('is the scroll that shows the last line, and never below zero', () => {
    expect(endScrollTop(box(0))).toBe(700);
    expect(
      endScrollTop({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }),
    ).toBe(0);
  });
});
