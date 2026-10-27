// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { messageOf } from './message-of';

describe('messageOf', () => {
  it('gives the message of an Error', () => {
    expect(messageOf(new Error('Down.'), 'Fallback.')).toBe('Down.');
  });

  it('gives the fallback for a value that is not an Error', () => {
    expect(messageOf('boom', 'Fallback.')).toBe('Fallback.');
  });
});
