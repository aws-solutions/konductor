// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { isSessionLost, lostSessionMessage, messageOf } from './message-of';

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
      `${error.message} If it stopped, start it again and get a fresh launch address from the server.`,
    );
  });

  it.each(['unauthorized', 'invalid_code'])(
    'tells to get a fresh launch address for the code %s',
    (code) => {
      const error = new ApiError('The session is gone.', 401, code);

      expect(messageOf(error, 'Fallback.')).toBe(
        'The session is gone. Get a fresh launch address from the server.',
      );
    },
  );

  it('takes a 401 with no body of the API for a lost session', () => {
    const error = new ApiError('The server answered 401.', 401);

    expect(isSessionLost(error)).toBe(true);
    expect(lostSessionMessage(error)).toBe(
      'The server answered 401. Get a fresh launch address from the server.',
    );
  });

  it.each([
    ['its own 401', new ApiError('Gone.', 401, 'unauthorized')],
    ['a bad launch code', new ApiError('Bad.', 400, 'invalid_code')],
  ])('takes %s for a lost session', (_, error) => {
    expect(isSessionLost(error)).toBe(true);
  });

  it.each([403, 404, 500])(
    'does not take a %i for a lost session',
    (status) => {
      expect(isSessionLost(new ApiError('No.', status))).toBe(false);
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
