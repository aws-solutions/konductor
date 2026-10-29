// SPDX-License-Identifier: Apache-2.0
import { ApiError, canRetryStatus } from './api';

const IF_STOPPED =
  'If it stopped, start it again and get a fresh launch address from the server.';
const NEW_SESSION = 'Get a fresh launch address from the server.';

/** Whether the server no longer knows the session: its own 401, or a proxy's. */
export function isSessionLost(error: ApiError): boolean {
  return (
    error.status === 401 ||
    error.code === 'unauthorized' ||
    error.code === 'invalid_code'
  );
}

// What a person can do about a failure that they can fix, or `undefined`.
// No answer, or a server error with no body of the API (the answer of a proxy
// whose server is down), means the server may have stopped. The API's own
// 401 means the session is gone, as after the server started again.
function nextStepOf(error: ApiError): string | undefined {
  if (error.code === 'unauthorized' || error.code === 'invalid_code') {
    return NEW_SESSION;
  }
  return error.code === undefined && canRetryStatus(error.status)
    ? IF_STOPPED
    : undefined;
}

/** The message of a lost session, with the way to get a new one. */
export function lostSessionMessage(error: ApiError): string {
  return error.message.includes(NEW_SESSION)
    ? error.message
    : `${error.message} ${NEW_SESSION}`;
}

/**
 * The message to show for a failure: that of the `Error`, with what to do
 * next when the failure is the server not answering or the session being
 * gone. `fallback` is for anything that is not an `Error`.
 */
export function messageOf(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const next = error instanceof ApiError ? nextStepOf(error) : undefined;
  return next === undefined ? error.message : `${error.message} ${next}`;
}
