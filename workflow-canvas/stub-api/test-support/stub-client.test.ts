// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import { StubClient } from './stub-client.ts';

const REPLY = 'HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\n\r\n{}';

describe('the stub client', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  /** A server that answers on the first bytes and drops the connection. */
  function answerAndHangUp(): Promise<number> {
    return new Promise((resolve) => {
      server = createServer((socket) => {
        socket.once('data', () => socket.end(REPLY, () => socket.destroy()));
        socket.on('error', () => {});
      });
      server.listen(0, LOOPBACK, () =>
        resolve((server!.address() as { port: number }).port),
      );
    });
  }

  it('survives a server that answers and hangs up while the body is still being sent', async () => {
    const client = new StubClient(await answerAndHangUp());
    const reply = await client.post('/x', undefined, {
      rawBody: 'x'.repeat(16 * 1024 * 1024),
    });
    expect(reply.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
