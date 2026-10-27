// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { messageOf } from './message-of';

describe('messageOf', () => {
  it('gives the message of an Error', () => {
    expect(messageOf(new Error('Down.'), 'Fallback.')).toBe('Down.');
  });

  it('gives the fallback for a value that is not an Error', () => {
    expect(messageOf('boom', 'Fallback.')).toBe('Fallback.');
  });

  it.each([
    ['no answer', new ApiError('The server did not answer.', 0)],
    ['a 502 from a proxy', new ApiError('The server answered 502.', 502)],
    ['a 504 from a proxy', new ApiError('The server answered 504.', 504)],
  ])('tells what to do when the server may have stopped: %s', (_, error) => {
    expect(messageOf(error, 'Fallback.')).toBe(
      `${error.message} If it stopped, start it again and open the launch address that it printed.`,
    );
  });

  it.each(['unauthorized', 'invalid_code'])(
    'tells to open the launch address again for the code %s',
    (code) => {
      const error = new ApiError('The session is gone.', 401, code);

      expect(messageOf(error, 'Fallback.')).toBe(
        'The session is gone. Open the launch address that the server printed.',
      );
    },
  );

  it.each([
    ['a refusal of the API', new ApiError('Not allowed.', 403, 'forbidden')],
    ['a failure of its storage', new ApiError('Disk.', 500, 'io_error')],
    ['a 404 with no code', new ApiError('Gone.', 404)],
  ])('adds nothing to %s', (_, error) => {
    expect(messageOf(error, 'Fallback.')).toBe(error.message);
  });
});
