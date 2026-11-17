// SPDX-License-Identifier: Apache-2.0
/** Calls GET /api/runs over HTTP; time is a fake clock. */
import { describe, expect, it } from 'vitest';
import { MAX_GOAL_CHARS } from '../core/contract.ts';
import { DEFAULT_STAGE_MS } from '../core/runs.ts';
import { expectContract, expectError } from '../test-support/contract.ts';
import { expectGuardedGet } from '../test-support/guarded.ts';
import { useStub, type TestStub } from '../test-support/harness.ts';
import { MAX_RUNS } from './queries.ts';

const RUNS = '/api/runs';

interface Row {
  run_id: string;
  started_at: string;
  status: string;
  goal: string;
  goal_truncated: boolean;
}

// Starts a run and lets it pass, so the next one may start.
async function runToEnd(stub: TestStub, goal: string): Promise<string> {
  const reply = await stub.client.post('/api/run', { params: { goal } });
  stub.clock.advance(2 * DEFAULT_STAGE_MS);
  return (reply.body as { run_id: string }).run_id;
}

async function rows(stub: TestStub, query = ''): Promise<Row[]> {
  const reply = await stub.client.get(`${RUNS}${query}`);
  expectContract(reply, 'GET', RUNS);
  expect(reply.status).toBe(200);
  return (reply.body as { runs: Row[] }).runs;
}

describe('GET /api/runs', () => {
  const stub = useStub();

  it('is empty before the first run', async () => {
    expect(await rows(stub())).toEqual([]);
  });

  it('lists the runs it played, newest first, each with its goal', async () => {
    const first = await runToEnd(stub(), 'Add a greeting');
    const second = await runToEnd(stub(), 'Add a changelog line');
    expect(await rows(stub())).toEqual([
      {
        run_id: second,
        started_at: '2026-10-24T04:12:11Z',
        status: 'passed',
        goal: 'Add a changelog line',
        goal_truncated: false,
      },
      {
        run_id: first,
        started_at: '2026-10-24T04:12:05Z',
        status: 'passed',
        goal: 'Add a greeting',
        goal_truncated: false,
      },
    ]);
  });

  it('carries a goal of the full limit whole, in code points', async () => {
    const goal = '😀'.repeat(MAX_GOAL_CHARS);
    await stub().client.post('/api/run', { params: { goal } });
    expect(await rows(stub())).toMatchObject([{ goal, goal_truncated: false }]);
  });

  it('lists the active run as running', async () => {
    await stub().client.post('/api/run', { params: { goal: 'Say hi' } });
    expect((await rows(stub()))[0]?.status).toBe('running');
  });

  it('returns at most limit runs', async () => {
    await runToEnd(stub(), 'One');
    await runToEnd(stub(), 'Two');
    const listed = await rows(stub(), '?limit=1');
    expect(listed.map((row) => row.goal)).toEqual(['Two']);
  });

  it.each([
    ['a limit of 0', '?limit=0'],
    [`a limit over ${MAX_RUNS}`, `?limit=${MAX_RUNS + 1}`],
    ['a limit that is not a number', '?limit=all'],
    ['a limit given twice', '?limit=1&limit=1'],
  ])('is a bad request with %s', async (_, query) => {
    const reply = await stub().client.get(`${RUNS}${query}`);
    expectContract(reply, 'GET', RUNS);
    expectError(reply, 400, 'bad_request');
  });

  it(`accepts a limit of ${MAX_RUNS}`, async () => {
    expect(await rows(stub(), `?limit=${MAX_RUNS}`)).toEqual([]);
  });

  it('asks for the token, its own Host and Origin, and a GET', async () => {
    await expectGuardedGet(stub(), RUNS);
  });
});

describe('GET /api/runs with a run that another program started', () => {
  const stub = useStub({ root: 'busy' });

  it('lists that run, with the goal of the workflow', async () => {
    await stub().client.post('/api/run', { params: { goal: 'Mine' } });
    expect(await rows(stub())).toMatchObject([
      { status: 'running', goal: 'Add a greeting to the README' },
    ]);
  });
});
