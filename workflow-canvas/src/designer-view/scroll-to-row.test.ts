// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { scrollTopFor } from './scroll-to-row';

const box = { top: 100, bottom: 400 };

describe('scrollTopFor', () => {
  it('puts a row below the box at its top', () => {
    expect(scrollTopFor(box, { top: 900, bottom: 920 }, 500, 'top')).toBe(1300);
  });

  it('puts a row above the box at its bottom', () => {
    expect(scrollTopFor(box, { top: 20, bottom: 40 }, 500, 'bottom')).toBe(140);
  });

  it('never gives a scroll below zero', () => {
    expect(scrollTopFor(box, { top: 0, bottom: 20 }, 10, 'top')).toBe(0);
  });
});
