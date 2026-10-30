// SPDX-License-Identifier: Apache-2.0
/** Calls GET and PUT /api/workflow over HTTP and checks them against the contract. */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../core/hash.ts';
import { SAMPLE_FILES } from '../core/sample.ts';
import {
  expectContract,
  expectError,
  requestExample,
  responseExample,
} from '../test-support/contract.ts';
import { useStub } from '../test-support/harness.ts';
import type { Reply } from '../test-support/stub-client.ts';

const PATH = '/api/workflow';
const HELLO = SAMPLE_FILES.hello ?? '';
const HELLO_HASH = sha256Hex(HELLO);
const ONE_STAGE =
  'format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Say hello\nstages:\n  - name: only\n    agent: k-developer\n';

interface Loaded {
  text: string | null;
  hash: string | null;
  view: { stages: { name: string; agent: string }[] } | null;
}

const ONE_STAGE_VIEW = {
  format: 'konductor/1',
  version: '0.1.0',
  name: 'hello',
  intent: { outcome: 'Say hello' },
  stages: [{ name: 'only', agent: 'k-developer' }],
};

async function load(reply: Promise<Reply>): Promise<Loaded> {
  return (await reply).body as Loaded;
}

describe('GET /api/workflow', () => {
  const stub = useStub();

  it('returns the sample workflow, its hash and its view', async () => {
    const reply = await stub().client.get(PATH);
    expectContract(reply, 'GET', PATH);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      name: 'hello',
      text: HELLO,
      hash: HELLO_HASH,
      read_only: false,
      view: {
        format: 'konductor/1',
        version: '0.1.0',
        name: 'hello',
        intent: {
          outcome: 'Add a greeting to the README',
          accept: [{ id: 'readme-exists', file: 'README.md' }],
        },
        params: {
          goal: {
            description: 'What the workflow should accomplish.',
            default: 'Add a greeting to the README',
          },
        },
        stages: [
          {
            name: 'draft',
            agent: 'k-developer',
            prompt: 'Write the greeting to README.md.',
          },
          {
            name: 'review',
            agent: 'k-quality-assurance',
            prompt_file: 'review.md',
          },
        ],
      },
      diagnostics: [],
    });
  });

  it('accepts the root by name', async () => {
    const reply = await stub().client.get(`${PATH}?name=hello`);
    expect(reply.status).toBe(200);
  });

  it('ignores a query parameter that is not name', async () => {
    expect((await stub().client.get(`${PATH}?other=1`)).status).toBe(200);
  });

  it('answers a workflow that is not the root with 404', async () => {
    const reply = await stub().client.get(`${PATH}?name=other`);
    expectContract(reply, 'GET', PATH);
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({ code: 'not_found' });
  });

  it.each(['Hello', '-x', '', 'a%20b', 'hello&name=hello'])(
    'answers the name %j with bad_name',
    async (name) => {
      const reply = await stub().client.get(`${PATH}?name=${name}`);
      expectContract(reply, 'GET', PATH);
      expect(reply.body).toMatchObject({ code: 'bad_name' });
    },
  );
});

describe('GET /api/workflow when the root has no file', () => {
  const stub = useStub({ files: {} });

  it('returns null text, hash and view', async () => {
    const reply = await stub().client.get(PATH);
    expectContract(reply, 'GET', PATH);
    expect(reply.body).toEqual(responseExample('GET', PATH, 200, 'new'));
  });
});

describe('GET /api/workflow with the file of the contract example', () => {
  const example = responseExample('GET', PATH, 200, 'existing') as Loaded;
  const stub = useStub({ files: { hello: example.text ?? '' } });

  it('returns exactly what the example shows', async () => {
    const reply = await stub().client.get(PATH);
    expect(reply.body).toEqual(example);
  });
});

describe('GET /api/workflow with text that has errors', () => {
  const stub = useStub({ files: { hello: 'name: hello\nowner: me\n' } });

  it('returns the text with a null view and the diagnostics', async () => {
    const reply = await stub().client.get(PATH);
    expectContract(reply, 'GET', PATH);
    expect(reply.body).toMatchObject({
      text: 'name: hello\nowner: me\n',
      view: null,
      diagnostics: [
        { code: 'MISSING_KEY' },
        { code: 'MISSING_KEY' },
        { code: 'MISSING_KEY' },
        { code: 'MISSING_KEY' },
        { code: 'UNKNOWN_KEY' },
      ],
    });
  });
});

describe('PUT /api/workflow', () => {
  const stub = useStub();
  const save = (text: string, base_hash: string | null, name?: string) =>
    stub().client.put(PATH, { name, text, base_hash });

  it('writes the text and returns its hash and view', async () => {
    const reply = await save(ONE_STAGE, HELLO_HASH);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      hash: sha256Hex(ONE_STAGE),
      view: ONE_STAGE_VIEW,
      diagnostics: [],
    });
    const loaded = await load(stub().client.get(PATH));
    expect(loaded).toMatchObject({
      text: ONE_STAGE,
      hash: sha256Hex(ONE_STAGE),
    });
  });

  it('keeps the bytes it was sent: a byte order mark, CRLF, no final newline', async () => {
    const text = `\uFEFF${ONE_STAGE.replaceAll('\n', '\r\n').trimEnd()}`;
    const reply = await save(text, HELLO_HASH);
    expect(reply.status).toBe(200);
    const loaded = await load(stub().client.get(PATH));
    expect(loaded.text).toBe(text);
    expect(loaded.hash).toBe(sha256Hex(text));
    expect((reply.body as { hash: string }).hash).toBe(sha256Hex(text));
  });

  it('is a 200 that changes nothing when the text is the file text', async () => {
    const reply = await save(HELLO, HELLO_HASH);
    expect(reply.status).toBe(200);
    expect(await load(stub().client.get(PATH))).toMatchObject({
      text: HELLO,
      hash: HELLO_HASH,
    });
  });

  it('is a conflict when the file changed since base_hash', async () => {
    await save(ONE_STAGE, HELLO_HASH);
    const reply = await save(HELLO, HELLO_HASH);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({
      ...(responseExample('PUT', PATH, 409, 'changed') as object),
      current_hash: sha256Hex(ONE_STAGE),
    });
    expect((await load(stub().client.get(PATH))).text).toBe(ONE_STAGE);
  });

  it('is a conflict with the current hash when base_hash is null but the file exists', async () => {
    const reply = await save(ONE_STAGE, null);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({
      ...(responseExample('PUT', PATH, 409, 'exists') as object),
      current_hash: HELLO_HASH,
    });
  });

  it('lets only one of two saves from the same base_hash succeed', async () => {
    const other = ONE_STAGE.replace('Say hello', 'Say hi');
    const replies = await Promise.all([
      save(ONE_STAGE, HELLO_HASH),
      save(other, HELLO_HASH),
    ]);
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('rejects an invalid text with its diagnostics and writes nothing', async () => {
    const reply = await save(
      'format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: a\nintent:\n  outcome: b\nstages:\n  - name: x\n    agent: y\n',
      HELLO_HASH,
    );
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({
      code: 'invalid_workflow',
      diagnostics: [
        { code: 'DUPLICATE_KEY', path: 'intent', line: 6, column: 1 },
      ],
    });
    expect((await load(stub().client.get(PATH))).hash).toBe(HELLO_HASH);
  });

  it('refuses a stage with parallel, and names the slice that adds it', async () => {
    const reply = await save(`${ONE_STAGE}    parallel: []\n`, HELLO_HASH);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({
      code: 'invalid_workflow',
      diagnostics: [
        {
          code: 'NOT_SUPPORTED_BY_THIS_BUILD',
          path: 'stages.only.parallel',
          message:
            'The key `parallel` is not supported by this build. Slice 6 adds it.',
        },
      ],
    });
    expect((await load(stub().client.get(PATH))).hash).toBe(HELLO_HASH);
  });

  it('answers the example of an unknown key with the example error', async () => {
    const request = requestExample('PUT', PATH, 'unknownKey');
    const reply = await stub().client.put(PATH, request);
    expect(reply.status).toBe(422);
    expect(reply.body).toEqual(responseExample('PUT', PATH, 422, 'invalid'));
  });

  it('is read-only for a workflow that is not the root', async () => {
    const reply = await save(ONE_STAGE, null, 'other');
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(403);
    expect(reply.body).toMatchObject({ code: 'read_only_workflow' });
  });

  it.each([
    ['not 64 hex digits', 'abc'],
    ['upper-case hex', HELLO_HASH.toUpperCase()],
  ])('is bad_hash when base_hash is %s', async (_, hash) => {
    const reply = await save(ONE_STAGE, hash);
    expectContract(reply, 'PUT', PATH);
    expect(reply.body).toMatchObject({ code: 'bad_hash' });
  });

  it.each([
    ['no text', { base_hash: null }],
    ['no base_hash', { text: ONE_STAGE }],
    ['a number as base_hash', { text: ONE_STAGE, base_hash: 5 }],
    ['an unknown field', { text: ONE_STAGE, base_hash: null, extra: 1 }],
  ])('is a bad request with %s', async (_, body) => {
    expectError(await stub().client.put(PATH, body), 400, 'bad_request');
  });

  it('checks the name format before the root, and the root before base_hash', async () => {
    expectError(await save(ONE_STAGE, 'abc', 'Other'), 400, 'bad_name');
    expectError(
      await save(ONE_STAGE, 'abc', 'other'),
      403,
      'read_only_workflow',
    );
  });

  it('checks the size of the text before its content', async () => {
    const reply = await save(`x: ${'#'.repeat(262_144)}`, HELLO_HASH);
    expectError(reply, 413, 'too_large');
  });
});

describe('PUT /api/workflow when the root has no file', () => {
  const stub = useStub({ files: {} });
  const create = (base_hash: string | null) =>
    stub().client.put(PATH, { text: ONE_STAGE, base_hash });

  it('creates the file with a base_hash of null', async () => {
    const reply = await create(null);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(200);
    expect((await load(stub().client.get(PATH))).text).toBe(ONE_STAGE);
  });

  it('creates it only once', async () => {
    await create(null);
    const reply = await create(null);
    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({
      code: 'conflict',
      current_hash: sha256Hex(ONE_STAGE),
    });
  });

  it('is a conflict without a current_hash when base_hash names a deleted file', async () => {
    const reply = await create(HELLO_HASH);
    expectContract(reply, 'PUT', PATH);
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual(responseExample('PUT', PATH, 409, 'deleted'));
  });
});
