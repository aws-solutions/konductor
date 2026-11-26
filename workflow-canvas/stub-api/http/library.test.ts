// SPDX-License-Identifier: Apache-2.0
/** Calls the workflow library routes over HTTP and checks every answer. */
import { describe, expect, it } from 'vitest';
import { isName } from '../core/contract.ts';
import { expectContract, expectError } from '../test-support/contract.ts';
import { useStub } from '../test-support/harness.ts';

const LIST_PATH = '/api/library';
const READY = 'library/k-adversarial-pull-request-review';
const PLANNED = 'library/k-design-doc-creation';
const entryPath = (name: string) => `/api/library/${encodeURIComponent(name)}`;
const copyPath = (name: string) => `${entryPath(name)}/copy`;

describe('GET /api/library', () => {
  const stub = useStub();

  it('lists ready and planned entries with the planned reason', async () => {
    const reply = await stub().client.get(LIST_PATH);

    expectContract(reply, 'GET', LIST_PATH);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ name: READY, status: 'ready' }),
        expect.objectContaining({
          name: PLANNED,
          status: 'planned',
          waits: expect.any(String),
        }),
      ]),
    });
  });
});

describe('GET /api/library with a named ready source', () => {
  const stub = useStub({
    library: [
      {
        name: READY,
        title: 'Named source',
        summary: 'A source that breaks the shipped invariant.',
        status: 'ready',
        text: 'format: konductor/1\nname: k-adversarial-pull-request-review\nversion: 0.1.0\nintent:\n  outcome: Review a change\nstages:\n  - name: review\n    agent: k-developer\n',
      },
    ],
  });

  it('refuses to advertise it', async () => {
    expectError(await stub().client.get(LIST_PATH), 500, 'io_error');
  });
});

describe('GET /api/library with duplicate lookup ids', () => {
  const stub = useStub({
    library: [
      {
        name: PLANNED,
        title: 'First',
        summary: 'First planned workflow.',
        status: 'planned',
        waits: 'A prerequisite.',
      },
      {
        name: PLANNED,
        title: 'Second',
        summary: 'Second planned workflow.',
        status: 'planned',
        waits: 'Another prerequisite.',
      },
    ],
  });

  it('refuses the ambiguous list', async () => {
    expectError(await stub().client.get(LIST_PATH), 500, 'io_error');
  });
});

describe.each([
  ['syntax-invalid', 'format: [\n'],
  [
    'semantically invalid',
    'format: konductor/1\nversion: 0.1.0\nintent:\n  outcome: Review a change\nstages: []\n',
  ],
])('GET /api/library with a %s ready source', (_kind, text) => {
  const stub = useStub({
    library: [
      {
        name: READY,
        title: 'Broken source',
        summary: 'A source that cannot be opened.',
        status: 'ready',
        text,
      },
    ],
  });

  it('refuses to advertise it', async () => {
    expectError(await stub().client.get(LIST_PATH), 500, 'io_error');
  });
});

describe('GET /api/library/{name}', () => {
  const stub = useStub();

  it('opens a ready entry as a read-only workflow document', async () => {
    const reply = await stub().client.get(entryPath(READY));

    expectContract(reply, 'GET', '/api/library/{name}');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      name: READY,
      read_only: true,
      view: { name: 'k-adversarial-pull-request-review' },
      diagnostics: [],
    });
  });

  it('refuses a planned entry', async () => {
    expectError(
      await stub().client.get(entryPath(PLANNED)),
      422,
      'not_available',
    );
  });

  it('answers a malformed library name with 400', async () => {
    expectError(
      await stub().client.get(entryPath('not-library')),
      400,
      'bad_name',
    );
  });

  it('answers an unknown entry with 404', async () => {
    expectError(
      await stub().client.get(entryPath('library/not-shipped')),
      404,
      'not_found',
    );
  });
});

describe('POST /api/library/{name}/copy', () => {
  const stub = useStub();

  it('copies a ready entry and makes the copy the editable root', async () => {
    const reply = await stub().client.post(copyPath(READY), {
      as: 'review-copy',
    });

    expectContract(reply, 'POST', '/api/library/{name}/copy');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      name: 'review-copy',
      read_only: false,
      view: { name: 'review-copy' },
    });
    expect(await stub().client.get('/api/workflow')).toMatchObject({
      status: 200,
      body: { name: 'review-copy', read_only: false },
    });
  });

  it('never overwrites an existing workflow', async () => {
    expectError(
      await stub().client.post(copyPath(READY), { as: 'hello' }),
      409,
      'conflict',
    );
  });

  it('refuses a planned entry', async () => {
    expectError(
      await stub().client.post(copyPath(PLANNED), { as: 'later' }),
      422,
      'not_available',
    );
  });

  it('answers an unknown entry with 404', async () => {
    expectError(
      await stub().client.post(copyPath('library/not-shipped'), {
        as: 'not-shipped-copy',
      }),
      404,
      'not_found',
    );
  });

  it.each(['Other', '-copy', 'a'.repeat(65)])(
    'reuses the workflow name rule for %j',
    async (name) => {
      expect(isName(name)).toBe(false);
      expectError(
        await stub().client.post(copyPath(READY), { as: name }),
        400,
        'bad_name',
      );
    },
  );

  it('refuses an unknown field', async () => {
    expectError(
      await stub().client.post(copyPath(READY), {
        as: 'review-copy',
        extra: true,
      }),
      400,
      'bad_request',
    );
  });
});
