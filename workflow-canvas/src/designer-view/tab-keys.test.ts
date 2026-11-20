// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { tabKeyTarget, type TabKey } from './tab-keys';

const press = (key: string, change: Partial<TabKey> = {}): TabKey => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...change,
});

describe('tabKeyTarget', () => {
  it.each([
    ['ArrowRight', 0, 1],
    ['ArrowRight', 1, 0],
    ['ArrowLeft', 1, 0],
    ['ArrowLeft', 0, 1],
    ['Home', 1, 0],
    ['End', 0, 1],
  ])('moves %s from tab %i to tab %i of two', (key, from, to) => {
    expect(tabKeyTarget(press(key), from, 2)).toBe(to);
  });

  it.each([
    ['Alt+Left', press('ArrowLeft', { altKey: true })],
    ['Ctrl+Right', press('ArrowRight', { ctrlKey: true })],
    ['Cmd+Left', press('ArrowLeft', { metaKey: true })],
    ['Shift+End', press('End', { shiftKey: true })],
    ['Down', press('ArrowDown')],
    ['Enter', press('Enter')],
  ])('leaves %s to the browser', (_, event) => {
    expect(tabKeyTarget(event, 0, 2)).toBeUndefined();
  });

  it('is undefined with no tabs', () => {
    expect(tabKeyTarget(press('Home'), 0, 0)).toBeUndefined();
  });
});
