// SPDX-License-Identifier: Apache-2.0
/** Calls GET /api/runs/{id}/events over HTTP; a long poll moves a fake clock. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE_MS } from '../core/runs.ts';
import { expectContract, expectError } from '../test-support/contract.ts';
import { expectGuardedGet } from '../test-support/guarded.ts';
import { useStub, type TestStub } from '../test-support/harness.ts';

const EVENTS = '/api/runs/{id}/events';
const GOAL = { params: { goal: 'Add a greeting to the README' } };

interface Page {
  events: { seq: number; type: string; stage?: string; status?: string }[];
  next: number;
  finished: boolean;
}

async function start(stub: TestStub): Promise<string> {
  const reply = await stub.client.post('/api/run', GOAL);
  return (reply.body as { run_id: string }).run_id;
}

async function events(stub: TestStub, runId: string, query = '') {
  const reply = await stub.client.get(`/api/runs/${runId}/events${query}`);
  expectContract(reply, 'GET', EVENTS);
  return reply;
}

async function page(stub: TestStub, runId: string, query = ''): Promise<Page> {
  const reply = await events(stub, runId, query);
  expect(reply.status).toBe(200);
  return reply.body as Page;
}

describe('GET /api/runs/{id}/events', () => {
  const stub = useStub();

  it('answers at once with the events so far', async () => {
    const runId = await start(stub());
    expect(await page(stub(), runId)).toEqual({
      events: [
        {
          seq: 1,
          run_id: runId,
          at: '2026-10-24T04:12:05Z',
          type: 'stage_state',
          stage: 'draft',
          status: 'running',
        },
      ],
      next: 1,
      finished: false,
    });
  });

  it('waits for the next event, then answers with it', async () => {
    const runId = await start(stub());
    const before = stub().clock.now();
    const { events } = await page(stub(), runId, '?after=1&wait=25');
    expect(events.map((e) => [e.seq, e.type])).toEqual([[2, 'console']]);
    expect(stub().clock.now() - before).toBe(DEFAULT_STAGE_MS / 3);
  });

  it('answers with no events when the wait ends first', async () => {
    const runId = await start(stub());
    const before = stub().clock.now();
    expect(await page(stub(), runId, '?after=1&wait=0')).toEqual({
      events: [],
      next: 1,
      finished: false,
    });
    expect(stub().clock.now()).toBe(before);
  });

  it('resumes from a seq, and follows the run to its end', async () => {
    const runId = await start(stub());
    let after = 0;
    const seen: string[] = [];
    for (let call = 0; call < 20; call++) {
      const read = await page(stub(), runId, `?after=${after}&wait=25`);
      seen.push(...read.events.map((e) => `${e.seq} ${e.type}`));
      after = read.next;
      if (read.finished) break;
    }
    expect(seen.at(-1)).toBe('9 run_finished');
    expect(seen).toHaveLength(9);
  });

  it('answers at once for a finished run, with no console line', async () => {
    const runId = await start(stub());
    stub().clock.advance(2 * DEFAULT_STAGE_MS);
    const before = stub().clock.now();
    const read = await page(stub(), runId, '?wait=25');
    expect(stub().clock.now()).toBe(before);
    expect(read.finished).toBe(true);
    expect(read.events.map((e) => e.seq)).toEqual([1, 4, 5, 8, 9]);
  });

  it.each([
    ['an after that is not a number', '?after=x'],
    ['a negative after', '?after=-1'],
    ['an after with a leading zero', '?after=01'],
    ['an after given twice', '?after=0&after=0'],
    ['a wait over 25 seconds', '?wait=26'],
    ['a wait that is not whole', '?wait=1.5'],
    ['a wait given twice', '?wait=1&wait=1'],
  ])('is a bad request with %s', async (_, query) => {
    const runId = await start(stub());
    expectError(await events(stub(), runId, query), 400, 'bad_request');
  });

  it('is a bad request with an after above the last seq of the run', async () => {
    const runId = await start(stub());
    expectError(await events(stub(), runId, '?after=2'), 400, 'bad_request');
  });

  it.each(['20261024-0412-99999', 'not-a-run-id'])(
    'is not_found for the run %s',
    async (runId) => {
      expectError(await events(stub(), runId), 404, 'not_found');
    },
  );

  it('checks the query before the run', async () => {
    const reply = await events(stub(), '20261024-0412-99999', '?wait=99');
    expectError(reply, 400, 'bad_request');
  });

  it('asks for the token, its own Host and Origin, and a GET', async () => {
    const runId = await start(stub());
    await expectGuardedGet(stub(), `/api/runs/${runId}/events`);
  });
});

describe('GET /api/runs/{id}/events of a run that halts', () => {
  const stub = useStub({ root: 'blocked' });

  it('ends with the blocked stage and a halted run', async () => {
    const runId = await start(stub());
    stub().clock.advance(2 * DEFAULT_STAGE_MS);
    const { events } = await page(stub(), runId);
    expect(events.slice(-2)).toMatchObject([
      { type: 'stage_state', stage: 'review', status: 'blocked' },
      { type: 'run_finished', status: 'halted', exit_code: 1 },
    ]);
  });
});
