// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { openStub, signIn } from './harness.ts';

const MIB = 1024 * 1024;

describe('the stub client', () => {
  it('survives a stub that answers and closes while the body is still being sent', async () => {
    for (let round = 0; round < 5; round++) {
      const test = await openStub();
      try {
        await signIn(test);
        const reply = await test.client.post('/api/validate', undefined, {
          rawBody: 'x'.repeat(32 * MIB),
          headers: { 'content-type': 'text/plain' },
        });
        expect(reply.status).toBe(400);
      } finally {
        await test.stub.close();
      }
    }
  });
});
