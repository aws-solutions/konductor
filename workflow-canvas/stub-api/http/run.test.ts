// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/** Calls POST /api/run and GET /api/runs/{id} over HTTP; time is a fake clock. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_MS } from '../core/runs.ts';
import {
  expectContract,
  expectError,
  responseExample,
} from '../test-support/contract.ts';
import { useStub, type TestStub } from '../test-support/harness.ts';

const RUN = '/api/run';
const RUNS = '/api/runs/{id}';
const GOAL = { params: { goal: 'Add a greeting to the README' } };

async function start(stub: TestStub): Promise<string> {
  const reply = await stub.client.post(RUN, GOAL);
  expectContract(reply, 'POST', RUN);
  return (reply.body as { run_id: string }).run_id;
}

async function stagesOf(stub: TestStub, runId: string): Promise<string[]> {
  const reply = await stub.client.get(`/api/runs/${runId}`);
  expectContract(reply, 'GET', RUNS);
  const { run } = reply.body as {
    run: { stages: Record<string, { status: string }> };
  };
  return Object.values(run.stages).map((stage) => stage.status);
}

describe('POST /api/run', () => {
  const stub = useStub();

  it('accepts the run at once and returns its id', async () => {
    const reply = await stub().client.post(RUN, GOAL);
    expectContract(reply, 'POST', RUN);
    expect(reply.status).toBe(202);
    expect(reply.body).toEqual({ run_id: '20261024-0412-00001' });
  });

  it('refuses a second run while one is active, with the id of the first', async () => {
    const runId = await start(stub());
    const reply = await stub().client.post(RUN, GOAL);
    expectContract(reply, 'POST', RUN);
    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({
      ...(responseExample('POST', RUN, 409, 'busy') as object),
      run_id: runId,
    });
  });

  it('accepts a new run once the first has finished', async () => {
    const first = await start(stub());
    stub().clock.advance(2 * DEFAULT_STAGE_MS);
    const second = await start(stub());
    expect(second).not.toBe(first);
  });

  it('works from the saved file: a save after the start does not change the run', async () => {
    const { client } = stub();
    const runId = await start(stub());
    const loaded = (await client.get('/api/workflow')).body as { hash: string };
    const text =
      'name: hello\nintent: x\nstages:\n  - name: only\n    agent: k-developer\n';
    expect(
      (await client.put('/api/workflow', { text, base_hash: loaded.hash }))
        .status,
    ).toBe(200);
    expect(await stagesOf(stub(), runId)).toHaveLength(2);
  });

  it.each([
    ['no goal', { params: {} }],
    ['an empty goal', { params: { goal: '' } }],
    ['another key in params', { params: { goal: 'x', extra: 1 } }],
    ['a goal of 2049 characters', { params: { goal: 'x'.repeat(2049) } }],
  ])('is bad_params with %s', async (_, body) => {
    const reply = await stub().client.post(RUN, body);
    expectContract(reply, 'POST', RUN);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({ code: 'bad_params' });
  });

  it('accepts a goal of 2048 code points', async () => {
    const goal = '😀'.repeat(2048);
    expect((await stub().client.post(RUN, { params: { goal } })).status).toBe(
      202,
    );
  });

  it.each([
    ['no params', {}],
    ['params that is not an object', { params: 'x' }],
    ['a goal that is not a string', { params: { goal: 7 } }],
    ['another field', { params: { goal: 'x' }, extra: 1 }],
  ])('is a bad request with %s', async (_, body) => {
    expectError(await stub().client.post(RUN, body), 400, 'bad_request');
  });

  it('checks the goal before the state of the run', async () => {
    await start(stub());
    expectError(
      await stub().client.post(RUN, { params: {} }),
      422,
      'bad_params',
    );
  });
});

describe('POST /api/run when the root has no file', () => {
  const stub = useStub({ files: {} });

  it('is not_found', async () => {
    expectError(await stub().client.post(RUN, GOAL), 404, 'not_found');
  });
});

describe('POST /api/run when the saved file has errors', () => {
  const stub = useStub({ files: { hello: 'name: hello\nowner: me\n' } });

  it('is invalid_workflow, with the diagnostics', async () => {
    const reply = await stub().client.post(RUN, GOAL);
    expectContract(reply, 'POST', RUN);
    expect(reply.status).toBe(422);
    expect(reply.body).toMatchObject({
      code: 'invalid_workflow',
      diagnostics: [
        { code: 'MISSING_KEY' },
        { code: 'MISSING_KEY' },
        { code: 'UNKNOWN_KEY' },
      ],
    });
  });
});

describe('GET /api/runs/{id}', () => {
  const stub = useStub();

  it('shows the first stage running when the run starts', async () => {
    const runId = await start(stub());
    const reply = await stub().client.get(`/api/runs/${runId}`);
    expectContract(reply, 'GET', RUNS);
    expect(reply.body).toEqual({
      run: {
        run_id: runId,
        workflow: 'hello',
        harness: 'kiro-cli',
        status: 'running',
        started_at: '2026-10-24T04:12:05Z',
        finished_at: null,
        exit_code: null,
        order: ['draft', 'review'],
        stages: { draft: { status: 'running' }, review: { status: 'pending' } },
      },
    });
  });

  it('goes through stage 1, stage 2 and the end as the clock moves', async () => {
    const runId = await start(stub());
    const seen = [await stagesOf(stub(), runId)];
    stub().clock.advance(DEFAULT_STAGE_MS);
    seen.push(await stagesOf(stub(), runId));
    stub().clock.advance(DEFAULT_STAGE_MS);
    seen.push(await stagesOf(stub(), runId));
    expect(seen).toEqual([
      ['running', 'pending'],
      ['passed', 'running'],
      ['passed', 'passed'],
    ]);
    const finished = await stub().client.get(`/api/runs/${runId}`);
    expect(finished.body).toMatchObject({
      run: {
        status: 'passed',
        finished_at: '2026-10-24T04:12:11Z',
        exit_code: 0,
      },
    });
  });

  it('stays readable after the run has finished', async () => {
    const runId = await start(stub());
    stub().clock.advance(10 * 60_000);
    const reply = await stub().client.get(`/api/runs/${runId}`);
    expect(reply.body).toMatchObject({ run: { status: 'passed' } });
  });

  it('is not_found for an id that was never given', async () => {
    const reply = await stub().client.get('/api/runs/20261024-0412-zzzzz');
    expectContract(reply, 'GET', RUNS);
    expect(reply.status).toBe(404);
    expect(reply.body).toMatchObject({ code: 'not_found' });
  });

  it.each(['abc', '20261024-0412-ABCDE', '20261024-0412-abcd', '../workflow'])(
    'is not_found, like a missing run, for the malformed id %s',
    async (id) => {
      const missing = await stub().client.get('/api/runs/20261024-0412-zzzzz');
      const malformed = await stub().client.get(
        `/api/runs/${encodeURIComponent(id)}`,
      );
      expect(malformed.status).toBe(404);
      expect(malformed.body).toEqual(missing.body);
    },
  );
});
