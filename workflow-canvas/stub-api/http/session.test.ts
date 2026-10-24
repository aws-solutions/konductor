// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Calls POST /api/session over HTTP and checks it against the contract. */
import { describe, expect, it } from 'vitest';
import { expectContract, expectError } from '../test-support/contract.ts';
import { LAUNCH_CODE, openStub, useStub } from '../test-support/harness.ts';
import { LAUNCH_WINDOW_MS } from './session.ts';

const SESSION = '/api/session';

describe('POST /api/session', () => {
  const stub = useStub({}, false);

  it('trades the launch code for a token and says what it serves', async () => {
    const reply = await stub().client.post(SESSION, { code: LAUNCH_CODE });
    expectContract(reply, 'POST', SESSION);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      token: expect.stringMatching(/^[\w-]{43}$/),
      root: 'hello',
      harness: 'kiro-cli',
      api_version: 1,
    });
  });

  it('works for the launch code once only', async () => {
    const { client } = stub();
    expect((await client.post(SESSION, { code: LAUNCH_CODE })).status).toBe(
      200,
    );
    const again = await client.post(SESSION, { code: LAUNCH_CODE });
    expectContract(again, 'POST', SESSION);
    expect(again.body).toMatchObject({ code: 'invalid_code' });
    expect(again.status).toBe(401);
  });

  it('refuses a wrong code and still accepts the right one', async () => {
    const { client } = stub();
    const wrong = await client.post(SESSION, { code: 'not-the-code' });
    expectContract(wrong, 'POST', SESSION);
    expect(wrong.status).toBe(401);
    expect(wrong.body).toMatchObject({ code: 'invalid_code' });
    expect((await client.post(SESSION, { code: LAUNCH_CODE })).status).toBe(
      200,
    );
  });

  it('accepts the launch code a millisecond before the window ends', async () => {
    const { client, clock } = stub();
    clock.advance(LAUNCH_WINDOW_MS - 1);
    expect((await client.post(SESSION, { code: LAUNCH_CODE })).status).toBe(
      200,
    );
  });

  it('refuses the launch code once 60 seconds have passed', async () => {
    const { client, clock } = stub();
    clock.advance(LAUNCH_WINDOW_MS);
    const reply = await client.post(SESSION, { code: LAUNCH_CODE });
    expectContract(reply, 'POST', SESSION);
    expect(reply.body).toMatchObject({ code: 'invalid_code' });
  });

  it.each([
    ['no code', {}],
    ['an empty code', { code: '' }],
    ['a code of 257 characters', { code: 'x'.repeat(257) }],
    ['a code that is not a string', { code: 7 }],
    ['another field', { code: LAUNCH_CODE, extra: true }],
    ['a body that is not an object', ['code']],
  ])('is a bad request with %s', async (_, body) => {
    const reply = await stub().client.post(SESSION, body);
    expectContract(reply, 'POST', SESSION);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ code: 'bad_request' });
  });
});

describe('the other calls', () => {
  const stub = useStub({}, false);
  const calls: [string, string, unknown][] = [
    ['GET', '/api/workflow', undefined],
    ['PUT', '/api/workflow', { text: 'x', base_hash: null }],
    ['POST', '/api/validate', { text: 'x' }],
    ['POST', '/api/run', { params: { goal: 'x' } }],
    ['GET', '/api/runs/20261024-0412-00001', undefined],
  ];

  it.each(calls)('%s %s needs the token', async (method, path, body) => {
    const { client } = stub();
    const reply = await client.call(method, path, { body });
    expectContract(reply, method, path.replace(/\/runs\/.*/, '/runs/{id}'));
    expect(reply.status).toBe(401);
    expect(reply.body).toMatchObject({ code: 'unauthorized' });
  });

  it('refuses a token that the stub did not give', async () => {
    const { client } = stub();
    client.token = 'made-up-token';
    expectError(await client.get('/api/workflow'), 401, 'unauthorized');
  });

  it('refuses the launch code as a token', async () => {
    const { client } = stub();
    client.token = LAUNCH_CODE;
    expectError(await client.get('/api/workflow'), 401, 'unauthorized');
  });
});

describe('the stub', () => {
  it('listens on the loopback address only', async () => {
    const { stub, client } = await openStub();
    try {
      expect(stub.origin).toBe(`http://127.0.0.1:${stub.port}`);
      expect(stub.launchAddress).toBe(`${stub.origin}/#${stub.launchCode}`);
      expect((await client.get('/api/workflow')).status).toBe(401);
    } finally {
      await stub.close();
    }
  });
});
