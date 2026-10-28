// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK } from '../address.ts';
import { lateWriteErrorListener, StubClient } from './stub-client.ts';

const REPLY = 'HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\n\r\n{}';
const BIG_BODY = 'x'.repeat(16 * 1024 * 1024);

describe('the stub client', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  /** A server that runs `onFirstBytes` once the request starts to arrive. */
  function serve(onFirstBytes: (socket: Socket) => void): Promise<StubClient> {
    return new Promise((resolve) => {
      server = createServer((socket) => {
        socket.once('data', () => onFirstBytes(socket));
        socket.on('error', () => {});
      });
      server.listen(0, LOOPBACK, () =>
        resolve(new StubClient((server!.address() as { port: number }).port)),
      );
    });
  }

  const closed = (socket: Socket) =>
    new Promise<void>((resolve) => socket.once('close', () => resolve()));

  it('survives a server that answers and hangs up while the body is still being sent', async () => {
    let hungUp: Promise<void> = Promise.resolve();
    const client = await serve((socket) => {
      hungUp = closed(socket);
      socket.end(REPLY, () => socket.destroy());
    });

    const reply = await client.post('/x', undefined, { rawBody: BIG_BODY });
    await hungUp;
    await new Promise((resolve) => setImmediate(resolve));

    expect(reply.status).toBe(400);
  });

  it.each([
    ['resets before any reply', (socket: Socket) => socket.resetAndDestroy()],
    [
      'resets in the middle of the reply',
      (socket: Socket) => {
        socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 2\r\n\r\n');
        setImmediate(() => socket.resetAndDestroy());
      },
    ],
  ])('rejects the call when the server %s', async (_, misbehave) => {
    const client = await serve(misbehave);
    await expect(
      client.post('/x', undefined, { rawBody: BIG_BODY }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/ECONNRESET|EPIPE/),
    });
  });
});

describe('lateWriteErrorListener', () => {
  const error = (code: string) =>
    Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

  it.each(['EPIPE', 'ECONNRESET'])(
    'ignores %s once the reply is complete',
    (code) => {
      expect(() =>
        lateWriteErrorListener({ complete: true })(error(code)),
      ).not.toThrow();
    },
  );

  it('rethrows any other error once the reply is complete', () => {
    expect(() =>
      lateWriteErrorListener({ complete: true })(error('EACCES')),
    ).toThrow('EACCES');
  });

  it('leaves every error to the request before the reply is complete', () => {
    expect(() =>
      lateWriteErrorListener({ complete: false })(error('EACCES')),
    ).not.toThrow();
  });
});
