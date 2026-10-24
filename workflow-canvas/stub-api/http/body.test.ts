// SPDX-License-Identifier: Apache-2.0
/** Checks how a request body is read, without a server. */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, MAX_DRAIN_BYTES, readJsonBody } from './body.ts';

/** A body of `chunks` chunks of `size` bytes, made as the reader asks for them. */
function bodyOf(chunks: number, size: number) {
  let made = 0;
  const stream = Readable.from(
    (function* () {
      while (made < chunks) {
        made++;
        yield Buffer.alloc(size, 'a');
      }
    })(),
  );
  return { stream, made: () => made };
}

describe('readJsonBody', () => {
  it('reads JSON', async () => {
    const body = Readable.from([Buffer.from('{"a":1}')]);
    await expect(readJsonBody(body)).resolves.toEqual({ a: 1 });
  });

  it('reads on past the limit, to the end, and then says too large', async () => {
    const { stream, made } = bodyOf(MAX_BODY_BYTES / 1024 + 1, 1024);
    await expect(readJsonBody(stream)).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(made()).toBe(MAX_BODY_BYTES / 1024 + 1);
  });

  it('cuts off a body that goes on past the drain limit', async () => {
    const chunk = 1024 * 1024;
    const { stream, made } = bodyOf(10 * (MAX_DRAIN_BYTES / chunk), chunk);
    await expect(readJsonBody(stream)).rejects.toMatchObject({
      code: 'too_large',
    });
    expect(made()).toBeLessThan(MAX_DRAIN_BYTES / chunk + 4);
    expect(stream.destroyed).toBe(true);
  });
});
