// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage } from 'node:http';
import { ApiError } from '../core/errors.ts';

/** The largest request body, in bytes. */
export const MAX_BODY_BYTES = 1_048_576;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Reads the body as UTF-8 JSON. A body over the limit is read to its end but
 * not kept, so the client is still there to receive the 413.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) {
    throw new ApiError('too_large', 'The request body is too large.');
  }
  try {
    return JSON.parse(utf8.decode(Buffer.concat(chunks)));
  } catch {
    throw new ApiError('bad_request', 'The request body is not valid.');
  }
}
