// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Calls POST /api/validate over HTTP and checks it against the contract. */
import { describe, expect, it } from 'vitest';
import {
  expectContract,
  expectError,
  requestExample,
  responseExample,
  responseExampleNames,
} from '../test-support/contract.ts';
import { useStub } from '../test-support/harness.ts';

const PATH = '/api/validate';

describe('POST /api/validate', () => {
  const stub = useStub();

  it.each(responseExampleNames('POST', PATH, 200))(
    'answers the %s request of the contract with its example',
    async (name) => {
      const request = requestExample('POST', PATH, name);
      const reply = await stub().client.post(PATH, request);
      expectContract(reply, 'POST', PATH);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual(responseExample('POST', PATH, 200, name));
    },
  );

  it('reports every problem in one answer, in the order of the text', async () => {
    const text = 'name: hello\nowner: me\nintent: 5\nstages:\n  - name: end\n';
    const reply = await stub().client.post(PATH, { text });
    expectContract(reply, 'POST', PATH);
    const body = reply.body as {
      errors: number;
      view: unknown;
      diagnostics: { code: string; line: number }[];
      summary: { valid: boolean; counts: { stages: number } };
    };
    expect(body.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['UNKNOWN_KEY', 2],
      ['WRONG_TYPE', 3],
      ['MISSING_KEY', 5],
      ['RESERVED_NAME', 5],
    ]);
    expect(body.errors).toBe(4);
    expect(body.view).toBeNull();
    expect(body.summary).toEqual({ valid: false, counts: { stages: 0 } });
  });

  it('writes nothing', async () => {
    const { client } = stub();
    const before = await client.get('/api/workflow');
    await client.post(PATH, {
      text: 'name: hello\nintent: x\nstages:\n  - name: a\n    agent: b\n',
    });
    expect(await client.get('/api/workflow')).toEqual(before);
  });

  it('checks the name of the text against the name of the request', async () => {
    const text = 'name: hello\nintent: x\nstages:\n  - name: a\n    agent: b\n';
    const reply = await stub().client.post(PATH, { name: 'hello', text });
    expect((reply.body as { errors: number }).errors).toBe(0);
  });

  it('answers a workflow that is not the root with read_only_workflow', async () => {
    const reply = await stub().client.post(PATH, { name: 'other', text: 'x' });
    expectContract(reply, 'POST', PATH);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ code: 'read_only_workflow' });
  });

  it('answers a malformed name with bad_name before the root check', async () => {
    expectError(
      await stub().client.post(PATH, { name: 'Bad Name', text: 'x' }),
      400,
      'bad_name',
    );
  });

  it.each([
    ['no text', {}],
    ['a text that is not a string', { text: 1 }],
    ['an unknown field', { text: 'x', base_hash: null }],
  ])('is a bad request with %s', async (_, body) => {
    const reply = await stub().client.post(PATH, body);
    expectContract(reply, 'POST', PATH);
    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ code: 'bad_request' });
  });
});
