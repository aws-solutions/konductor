// SPDX-License-Identifier: Apache-2.0
/** Calls GET /api/agents over HTTP and checks it against the contract. */
import { describe, expect, it } from 'vitest';
import { expectContract, responseExample } from '../test-support/contract.ts';
import { expectGuardedGet } from '../test-support/guarded.ts';
import { useStub } from '../test-support/harness.ts';

const PATH = '/api/agents';

describe('GET /api/agents', () => {
  const stub = useStub();

  it('lists the agents a stage may name, as the contract example shows', async () => {
    const reply = await stub().client.get(PATH);
    expectContract(reply, 'GET', PATH);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(responseExample('GET', PATH, 200));
  });

  it('asks for the token, its own Host and Origin, and a GET', async () => {
    await expectGuardedGet(stub(), PATH);
  });
});
