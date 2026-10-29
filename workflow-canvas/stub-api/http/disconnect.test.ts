// SPDX-License-Identifier: Apache-2.0
/** Checks that a client which drops its connection cannot take the stub down. */
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';
import { useStub } from '../test-support/harness.ts';

const MIB = 1024 * 1024;

describe('a client that drops its connection', () => {
  const stub = useStub();

  /**
   * Declares a body of `declared` bytes, sends only `sent` of them, then resets
   * the connection. With `sent` below `declared` the stub is still waiting for
   * the body when the reset arrives.
   */
  function dropMidRequest(
    port: number,
    token: string,
    declared: number,
    sent: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        const head = `POST /api/validate HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n`;
        socket.write(head + 'x'.repeat(sent), () => {
          socket.resetAndDestroy();
          resolve();
        });
      });
      socket.on('error', () => {});
    });
  }

  it.each([
    ['in the middle of a body', 2 * MIB, MIB],
    ['before any body arrives', MIB, 0],
  ])('leaves the stub serving, %s', async (_, declared, sent) => {
    const { stub: running, client } = stub();
    await dropMidRequest(running.port, client.token!, declared, sent);
    expect((await client.get('/api/workflow')).status).toBe(200);
  });
});
