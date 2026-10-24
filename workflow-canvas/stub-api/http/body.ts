// SPDX-License-Identifier: Apache-2.0
import type { Readable } from 'node:stream';
import { ApiError, badRequest } from '../core/errors.ts';

/** The largest request body, in bytes. */
export const MAX_BODY_BYTES = 1_048_576;
/** The most of a body that is read, though not kept, to answer a 413. */
export const MAX_DRAIN_BYTES = 16 * MAX_BODY_BYTES;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const tooLarge = () =>
  new ApiError('too_large', 'The request body is too large.');

/**
 * Reads the body as UTF-8 JSON. A body over the limit is read on, not kept, so
 * the client gets its 413. Past the drain limit the request is cut off.
 */
export async function readJsonBody(req: Readable): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_DRAIN_BYTES) {
      req.destroy();
      throw tooLarge();
    }
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) throw tooLarge();
  try {
    return JSON.parse(utf8.decode(Buffer.concat(chunks)));
  } catch {
    throw badRequest();
  }
}
