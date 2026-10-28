// SPDX-License-Identifier: Apache-2.0
/** Checks that a client which drops its connection cannot take the stub down. */
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { useStub } from '../test-support/harness.ts';

const MIB = 1024 * 1024;

describe('a client that drops its connection', () => {
  const stub = useStub();

  /** Sends part of a request, then resets the connection. */
  function dropMidRequest(port: number, bodyBytes: number): Promise<void> {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        const head = `POST /api/validate HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: ${2 * bodyBytes}\r\n\r\n`;
        socket.write(head + 'x'.repeat(bodyBytes), () => {
          socket.resetAndDestroy();
          resolve();
        });
      });
      socket.on('error', () => {});
    });
  }

  it.each([
    ['in the middle of a body', MIB],
    ['before any body arrives', 0],
  ])('leaves the stub serving, %s', async (_, bodyBytes) => {
    const { stub: running, client } = stub();
    await dropMidRequest(running.port, bodyBytes);
    expect((await client.get('/api/workflow')).status).toBe(200);
  });
});
