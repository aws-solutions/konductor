// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { messageParts, plainText } from './message-parts';

describe('messageParts', () => {
  it('puts each name in backticks at an odd place, without the ticks', () => {
    expect(messageParts('`name` must be `hello`.')).toEqual([
      '',
      'name',
      ' must be ',
      'hello',
      '.',
    ]);
  });

  it('keeps a message with no pair of backticks whole', () => {
    expect(messageParts('It costs 5` or less.')).toEqual([
      'It costs 5` or less.',
    ]);
  });
});

describe('plainText', () => {
  it('drops the ticks around each name and keeps the rest', () => {
    expect(plainText('Start `flow view` again and open `the address`.')).toBe(
      'Start flow view again and open the address.',
    );
  });

  it('leaves a single backtick, and a pair split by a line break, as they are', () => {
    expect(plainText('It costs 5` or less.')).toBe('It costs 5` or less.');
    expect(plainText('a `b\nc` d')).toBe('a `b\nc` d');
  });
});
