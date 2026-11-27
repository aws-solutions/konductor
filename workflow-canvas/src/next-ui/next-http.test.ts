// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import {
  RunAlreadyActive,
  RunNeedsTrust,
  RunStartUnsure,
} from '../execution/core/ports';
import { COPY_UNCERTAIN_CODE, createNextPorts } from './next-http';

const TOKEN = 'token-1';
const RUN_ID = '20261024-0412-a7b3c';

const DOCUMENT = {
  name: 'hello',
  text: 'format: konductor/1\n',
  hash: 'a'.repeat(64),
  read_only: false,
  view: {
    format: 'konductor/1',
    version: '0.1.0',
    name: 'hello',
    intent: { outcome: 'Add a greeting' },
    params: { goal: { default: 'Say hello' } },
    stages: [
      {
        name: 'draft',
        kind: 'agent',
        agent: 'k-developer',
        range: { line: 7, end_line: 8 },
      },
    ],
  },
  diagnostics: [],
  stage_fields: {
    agent: [{ key: 'name', type: 'name', required: true }],
  },
};

const RUN_ROW = {
  run_id: RUN_ID,
  started_at: '2026-10-24T04:12:05Z',
  status: 'running',
  goal: 'Say hello',
  goal_truncated: false,
};

interface Call {
  path: string;
  init: RequestInit;
}

function serverOf(
  reply: { status?: number; body?: unknown; text?: string } = {},
) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (path: unknown, init: unknown) => {
    calls.push({ path: String(path), init: (init ?? {}) as RequestInit });
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () =>
        reply.text === undefined
          ? reply.body
          : Promise.reject(new SyntaxError('not JSON')),
    } as unknown as Response;
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

function sequenceServerOf(
  replies: readonly { status?: number; body: unknown }[],
) {
  const calls: string[] = [];
  let next = 0;
  const fetchFn = vi.fn(async (path: unknown) => {
    calls.push(String(path));
    const reply = replies[next++] ?? { status: 500, body: {} };
    const status = reply.status ?? 200;
    return new Response(JSON.stringify(reply.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

function interruptedCopyServerOf(recovery: unknown, source: unknown) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (path: unknown) => {
    calls.push(String(path));
    if (calls.length === 1) throw new TypeError('network error');
    const body = calls.length === 2 ? recovery : source;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

const headerOf = (call: Call | undefined) =>
  (call?.init.headers as Record<string, string> | undefined)?.Authorization;

describe('createNextPorts, the extra fields of the workflow', () => {
  it('reads them from the workflow of the session', async () => {
    const { calls, fetchFn } = serverOf({ body: DOCUMENT });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const extras = await ports.loadExtras();

    expect(calls[0]?.path).toBe('/api/workflow');
    expect(headerOf(calls[0])).toBe(`Bearer ${TOKEN}`);
    expect(extras.stageFields.agent).toEqual([
      { key: 'name', type: 'name', required: true },
    ]);
    expect(extras.goalDefault).toBe('Say hello');
  });

  it('refuses a reply that does not fit the contract', async () => {
    const { fetchFn } = serverOf({ body: { name: 'hello' } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.loadExtras()).rejects.toThrow(ApiError);
  });
});

describe('createNextPorts, the agents', () => {
  it('lists the agents the server gives', async () => {
    const { calls, fetchFn } = serverOf({
      body: { agents: [{ id: 'k-developer', summary: 'Code' }] },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const agents = await ports.listAgents();

    expect(calls[0]?.path).toBe('/api/agents');
    expect(agents).toEqual([{ id: 'k-developer', summary: 'Code' }]);
  });

  it('refuses a list that is not of agents', async () => {
    const { fetchFn } = serverOf({ body: { agents: ['k-developer'] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listAgents()).rejects.toThrow(ApiError);
  });
});

describe('createNextPorts, the library', () => {
  const ready = {
    name: 'library/k-adversarial-pull-request-review',
    title: 'Adversarial pull request review',
    summary: 'Review a pull request.',
    status: 'ready',
  };
  const planned = {
    name: 'library/k-design-doc-creation',
    title: 'Design document creation',
    summary: 'Create a design document.',
    status: 'planned',
    waits: 'The workflow needs human gates.',
  };

  const detailDocument = {
    ...DOCUMENT,
    name: ready.name,
    read_only: true,
    view: { ...DOCUMENT.view, name: 'k-adversarial-pull-request-review' },
  };
  const copyDocument = (name: string) => ({
    ...DOCUMENT,
    name,
    view: { ...DOCUMENT.view, name },
  });

  function sharedCopyServerOf({ libraryFails = false } = {}) {
    let root = DOCUMENT;
    let copyRequests = 0;
    const calls: string[] = [];
    const fetchFn = vi.fn(async (path: unknown, init: RequestInit = {}) => {
      const requestPath = String(path);
      calls.push(requestPath);
      if (init.method === 'POST') {
        copyRequests += 1;
        if (copyRequests === 1) {
          root = copyDocument('review-copy');
          return new Response(JSON.stringify(root), { status: 200 });
        }
        throw new TypeError('copy refusal reply lost');
      }
      if (requestPath === '/api/workflow') {
        return new Response(JSON.stringify(root), { status: 200 });
      }
      if (requestPath === `/api/library/${encodeURIComponent(ready.name)}`) {
        return new Response(
          JSON.stringify(
            libraryFails
              ? { error: 'The Library source could not be read.' }
              : detailDocument,
          ),
          { status: libraryFails ? 500 : 200 },
        );
      }
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
      });
    }) as unknown as typeof fetch;
    return {
      calls,
      fetchFn,
      editRoot: (text: string) => {
        root = {
          ...copyDocument('review-copy'),
          text,
          hash: 'b'.repeat(64),
        };
      },
    };
  }

  it('lists ready and planned entries', async () => {
    const { calls, fetchFn } = serverOf({
      body: { entries: [ready, planned] },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).resolves.toEqual([ready, planned]);
    expect(calls[0]?.path).toBe('/api/library');
  });

  it('accepts the list and display limits at their maximum', async () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      ...planned,
      name: `library/workflow-${index}`,
      title: 't'.repeat(120),
      summary: 's'.repeat(240),
      waits: 'w'.repeat(240),
    }));
    const { fetchFn } = serverOf({ body: { entries } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).resolves.toHaveLength(100);
  });

  it('refuses one entry over the list limit', async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      ...ready,
      name: `library/workflow-${index}`,
    }));
    const { fetchFn } = serverOf({ body: { entries } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).rejects.toThrow(ApiError);
  });

  it.each([
    ['title', { ...ready, title: 't'.repeat(121) }],
    ['summary', { ...ready, summary: 's'.repeat(241) }],
    ['waits', { ...planned, waits: 'w'.repeat(241) }],
  ])('refuses a %s one character over its limit', async (_, entry) => {
    const { fetchFn } = serverOf({ body: { entries: [entry] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).rejects.toThrow(ApiError);
  });

  it('refuses duplicate lookup ids', async () => {
    const { fetchFn } = serverOf({
      body: { entries: [ready, { ...ready, title: 'Another row' }] },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).rejects.toThrow(ApiError);
  });

  it('opens a ready entry read-only', async () => {
    const name = 'library/k-adversarial-pull-request-review';
    const { calls, fetchFn } = serverOf({ body: detailDocument });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.getLibrary(name)).resolves.toMatchObject({
      name,
      readOnly: true,
    });
    expect(calls[0]?.path).toBe(`/api/library/${encodeURIComponent(name)}`);
  });

  it('copies a ready entry under the requested name', async () => {
    const name = 'library/k-adversarial-pull-request-review';
    const { calls, fetchFn } = serverOf({ body: copyDocument('review-copy') });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.copyLibrary(name, 'review-copy')).resolves.toMatchObject(
      { name: 'review-copy', readOnly: false },
    );
    expect(calls[0]?.path).toBe(
      `/api/library/${encodeURIComponent(name)}/copy`,
    );
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ as: 'review-copy' }),
    });
  });

  it('blocks when another tab edited the target before a lost refusal', async () => {
    const server = sharedCopyServerOf();
    const tabA = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    const tabB = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    await tabB.copyLibrary(ready.name, 'review-copy');
    server.editRoot(`${detailDocument.text}# edited by tab B\n`);

    const failure = await tabA
      .copyLibrary(ready.name, 'review-copy')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(COPY_UNCERTAIN_CODE);
    expect(server.calls).toContain(
      `/api/library/${encodeURIComponent(ready.name)}`,
    );
  });

  it('accepts another tab unedited copy after a lost refusal', async () => {
    const server = sharedCopyServerOf();
    const tabA = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    const tabB = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    await tabB.copyLibrary(ready.name, 'review-copy');

    await expect(
      tabA.copyLibrary(ready.name, 'review-copy'),
    ).resolves.toMatchObject({
      name: 'review-copy',
      text: detailDocument.text,
    });
    expect(server.calls).toContain(
      `/api/library/${encodeURIComponent(ready.name)}`,
    );
  });

  it('blocks when the Library source cannot be read during reconciliation', async () => {
    const server = sharedCopyServerOf({ libraryFails: true });
    const tabA = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    const tabB = createNextPorts(TOKEN, { fetchFn: server.fetchFn });
    await tabB.copyLibrary(ready.name, 'review-copy');

    const failure = await tabA
      .copyLibrary(ready.name, 'review-copy')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(COPY_UNCERTAIN_CODE);
  });

  it('recovers a committed copy after an unreadable success body', async () => {
    let root = 'hello';
    const calls: string[] = [];
    const fetchFn = vi.fn(async (path: unknown, init: RequestInit = {}) => {
      calls.push(String(path));
      if (init.method === 'POST') {
        root = 'review-copy';
        return new Response(JSON.stringify({ copied: true }), { status: 200 });
      }
      if (String(path).startsWith('/api/library/')) {
        return new Response(JSON.stringify(detailDocument), { status: 200 });
      }
      return new Response(JSON.stringify(copyDocument(root)), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.copyLibrary(ready.name, 'review-copy'),
    ).resolves.toMatchObject({ name: 'review-copy', readOnly: false });
    expect(root).toBe('review-copy');
    expect(calls).toEqual([
      `/api/library/${encodeURIComponent(ready.name)}/copy`,
      '/api/workflow',
      `/api/library/${encodeURIComponent(ready.name)}`,
    ]);
  });

  it('recovers when a committed copy response body fails to read', async () => {
    let root = 'hello';
    const calls: string[] = [];
    const fetchFn = vi.fn(async (path: unknown, init: RequestInit = {}) => {
      calls.push(String(path));
      if (init.method === 'POST') {
        root = 'review-copy';
        return {
          ok: true,
          status: 200,
          json: () => Promise.reject(new TypeError('body stream failed')),
        } as Response;
      }
      if (String(path).startsWith('/api/library/')) {
        return new Response(JSON.stringify(detailDocument), { status: 200 });
      }
      return new Response(JSON.stringify(copyDocument(root)), { status: 200 });
    }) as unknown as typeof fetch;
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.copyLibrary(ready.name, 'review-copy'),
    ).resolves.toMatchObject({ name: 'review-copy', readOnly: false });
    expect(root).toBe('review-copy');
    expect(calls).toEqual([
      `/api/library/${encodeURIComponent(ready.name)}/copy`,
      '/api/workflow',
      `/api/library/${encodeURIComponent(ready.name)}`,
    ]);
  });

  it.each([500, 408, 429])(
    'reconciles a committed copy after status %i',
    async (status) => {
      const { calls, fetchFn } = sequenceServerOf([
        { status, body: { error: 'Reply lost.' } },
        { body: copyDocument('review-copy') },
        { body: detailDocument },
      ]);
      const ports = createNextPorts(TOKEN, { fetchFn });

      await expect(
        ports.copyLibrary(ready.name, 'review-copy'),
      ).resolves.toMatchObject({ name: 'review-copy' });
      expect(calls[1]).toBe('/api/workflow');
    },
  );

  it.each([500, 408, 429])(
    'blocks an unconfirmed copy after status %i',
    async (status) => {
      const { calls, fetchFn } = sequenceServerOf([
        { status, body: { error: 'Reply lost.' } },
        { body: DOCUMENT },
      ]);
      const ports = createNextPorts(TOKEN, { fetchFn });

      const failure = await ports
        .copyLibrary(ready.name, 'review-copy')
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe(COPY_UNCERTAIN_CODE);
      expect(calls[1]).toBe('/api/workflow');
    },
  );

  it('reconciles a committed copy after the server does not answer', async () => {
    const { calls, fetchFn } = interruptedCopyServerOf(
      copyDocument('review-copy'),
      detailDocument,
    );
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.copyLibrary(ready.name, 'review-copy'),
    ).resolves.toMatchObject({ name: 'review-copy' });
    expect(calls[1]).toBe('/api/workflow');
  });

  it('blocks an unconfirmed copy after the server does not answer', async () => {
    const { calls, fetchFn } = interruptedCopyServerOf(
      DOCUMENT,
      detailDocument,
    );
    const ports = createNextPorts(TOKEN, { fetchFn });

    const failure = await ports
      .copyLibrary(ready.name, 'review-copy')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(COPY_UNCERTAIN_CODE);
    expect(calls[1]).toBe('/api/workflow');
  });

  it('leaves a clear copy refusal as an ordinary failure', async () => {
    const { calls, fetchFn } = sequenceServerOf([
      { status: 409, body: { error: 'Name exists.', code: 'conflict' } },
    ]);
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.copyLibrary(ready.name, 'review-copy'),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['the recovery read fails', { status: 500, body: { error: 'Failed.' } }],
    ['another workflow is open', { body: DOCUMENT }],
  ])('blocks after an unreadable copy when %s', async (_, recovery) => {
    const { fetchFn } = sequenceServerOf([
      { body: { copied: true } },
      recovery,
    ]);
    const ports = createNextPorts(TOKEN, { fetchFn });

    const failure = await ports
      .copyLibrary(ready.name, 'review-copy')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(COPY_UNCERTAIN_CODE);
  });

  it.each([
    ['an editable detail', { ...detailDocument, read_only: false }],
    ['another detail name', { ...detailDocument, name: 'library/another' }],
    ['no parsed view', { ...detailDocument, view: null }],
    ['a null hash', { ...detailDocument, hash: null }],
    ['a malformed hash', { ...detailDocument, hash: 'not-a-hash' }],
    [
      'a mismatched view name',
      { ...detailDocument, view: { ...detailDocument.view, name: 'other' } },
    ],
  ])('refuses a detail with %s', async (_, document) => {
    const { fetchFn } = serverOf({ body: document });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.getLibrary(ready.name)).rejects.toThrow(ApiError);
  });

  it.each([
    ['a read-only flag', { ...copyDocument('review-copy'), read_only: true }],
    ['a null hash', { ...copyDocument('review-copy'), hash: null }],
    ['a malformed hash', { ...copyDocument('review-copy'), hash: 'bad' }],
    [
      'a mismatched view name',
      {
        ...copyDocument('review-copy'),
        view: { ...DOCUMENT.view, name: 'other' },
      },
    ],
  ])('reconciles a copy with %s', async (_, badCopy) => {
    const { calls, fetchFn } = sequenceServerOf([
      { body: badCopy },
      { body: copyDocument('review-copy') },
      { body: detailDocument },
    ]);
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.copyLibrary(ready.name, 'review-copy'),
    ).resolves.toMatchObject({ name: 'review-copy' });
    expect(calls[1]).toBe('/api/workflow');
  });

  it.each([
    ['a ready entry with waits', { ...ready, waits: 'No reason.' }],
    ['a planned entry without waits', { ...planned, waits: undefined }],
    ['a multiline title', { ...ready, title: 'One\nTwo' }],
    ['a multiline reason', { ...planned, waits: 'One\nTwo' }],
    ['an unknown status', { ...ready, status: 'retired' }],
    ['an empty summary', { ...ready, summary: '' }],
  ])('refuses %s', async (_, entry) => {
    const { fetchFn } = serverOf({ body: { entries: [entry] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listLibrary()).rejects.toThrow(ApiError);
  });
});

describe('createNextPorts, the past runs', () => {
  it('lists the runs the server gives', async () => {
    const { calls, fetchFn } = serverOf({ body: { runs: [RUN_ROW] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const runs = await ports.listRuns(new AbortController().signal);

    expect(calls[0]?.path).toBe('/api/runs');
    expect(runs).toEqual([RUN_ROW]);
  });

  it.each([
    ['a status it does not know', { ...RUN_ROW, status: 'paused' }],
    ['no start time', { ...RUN_ROW, started_at: undefined }],
    ['no goal', { ...RUN_ROW, goal: undefined }],
    ['no goal_truncated', { ...RUN_ROW, goal_truncated: undefined }],
  ])('refuses a run with %s', async (_, run) => {
    const { fetchFn } = serverOf({ body: { runs: [run] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.listRuns(new AbortController().signal)).rejects.toThrow(
      ApiError,
    );
  });
});

describe('createNextPorts, the start of a run', () => {
  const signal = () => new AbortController().signal;

  it('sends the goal and the params, and gives back the run id', async () => {
    const { calls, fetchFn } = serverOf({
      status: 202,
      body: { run_id: RUN_ID },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const runId = await ports.startRun(
      'hello',
      { goal: 'Add a greeting', diff_input: 'the.diff' },
      signal(),
    );

    expect(runId).toBe(RUN_ID);
    expect(calls[0]?.path).toBe('/api/run');
    expect(calls[0]?.init.method).toBe('POST');
    expect(headerOf(calls[0])).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: 'hello',
      params: { goal: 'Add a greeting', diff_input: 'the.diff' },
    });
  });

  it('follows the run the server already has', async () => {
    const { fetchFn } = serverOf({
      status: 409,
      body: {
        error: 'A run is already active.',
        code: 'already_running',
        run_id: RUN_ID,
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const failed = await ports
      .startRun('hello', { goal: 'Add a greeting' }, signal())
      .catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(RunAlreadyActive);
    expect((failed as RunAlreadyActive).runId).toBe(RUN_ID);
  });

  it('asks for trust with the server fix', async () => {
    const fix =
      'Run `konductor flow trust hello` in a terminal, then try again.';
    const { fetchFn } = serverOf({
      status: 409,
      body: {
        error: 'The workflow is not trusted yet.',
        code: 'trust_required',
        fix,
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const failed = await ports
      .startRun('hello', { goal: 'Add a greeting' }, signal())
      .catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(RunNeedsTrust);
    expect((failed as RunNeedsTrust).fix).toBe(fix);
  });

  it('says what the server said about params it refused', async () => {
    const { fetchFn } = serverOf({
      status: 422,
      body: {
        error: 'The workflow does not declare the param "branch".',
        code: 'bad_params',
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.startRun(
        'hello',
        { goal: 'Add a greeting', branch: 'main' },
        signal(),
      ),
    ).rejects.toThrow('does not declare the param "branch"');
  });

  it('is unsure when the server does not answer', async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new Error('socket closed')),
    ) as unknown as typeof fetch;
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.startRun('hello', { goal: 'Add a greeting' }, signal()),
    ).rejects.toThrow(RunStartUnsure);
  });

  it('is unsure when the accepted run has a reply it cannot read', async () => {
    const { fetchFn } = serverOf({ status: 202, body: { run_id: 7 } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.startRun('hello', { goal: 'Add a greeting' }, signal()),
    ).rejects.toThrow(/may have started/);
  });

  it('tells the page when the server no longer knows the session', async () => {
    const { fetchFn } = serverOf({
      status: 401,
      body: { error: 'The session is gone.' },
    });
    const lost = vi.fn();
    const ports = createNextPorts(TOKEN, { fetchFn, onSessionLost: lost });

    await expect(
      ports.startRun('hello', { goal: 'Add a greeting' }, signal()),
    ).rejects.toThrow(/Start `flow view` again/);
    expect(lost).toHaveBeenCalledTimes(1);
  });
});

describe('createNextPorts, the checks of a run', () => {
  const signal = () => new AbortController().signal;

  it('reads the state of each check of the run', async () => {
    const { calls, fetchFn } = serverOf({
      body: {
        run: {
          run_id: RUN_ID,
          checks: { 'readme-exists': 'verified', 'tests-pass': 'deferred' },
        },
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const states = await ports.readChecks(RUN_ID, signal());

    expect(calls[0]?.path).toBe(`/api/runs/${RUN_ID}`);
    expect(headerOf(calls[0])).toBe(`Bearer ${TOKEN}`);
    expect(states).toEqual({
      'readme-exists': 'verified',
      'tests-pass': 'deferred',
    });
  });

  it('reads an empty map for a workflow that declares no check', async () => {
    const { fetchFn } = serverOf({ body: { run: { checks: {} } } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    expect(await ports.readChecks(RUN_ID, signal())).toEqual({});
  });

  it('keeps a state it does not know, for the view to judge', async () => {
    const { fetchFn } = serverOf({
      body: { run: { checks: { 'readme-exists': 'reported' } } },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    expect(await ports.readChecks(RUN_ID, signal())).toEqual({
      'readme-exists': 'reported',
    });
  });

  it.each([
    ['no checks at all', { run: { run_id: RUN_ID } }],
    ['checks that are not a mapping', { run: { checks: [] } }],
    ['a state that is not a string', { run: { checks: { a: 1 } } }],
    ['no run', { checks: {} }],
  ])('refuses a reply with %s', async (_, body) => {
    const { fetchFn } = serverOf({ body });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.readChecks(RUN_ID, signal())).rejects.toThrow(ApiError);
  });
});

describe('createNextPorts, the events of a run', () => {
  it('asks for the events after the sequence it was given', async () => {
    const { calls, fetchFn } = serverOf({ body: { events: [], next: 0 } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const reply = await ports.readEvents(
      RUN_ID,
      3,
      20,
      new AbortController().signal,
    );

    expect(calls[0]?.path).toBe(`/api/runs/${RUN_ID}/events?after=3&wait=20`);
    expect(headerOf(calls[0])).toBe(`Bearer ${TOKEN}`);
    expect(reply.ok).toBe(true);
  });

  it('gives the reply as it came, for the follower to read', async () => {
    const { fetchFn } = serverOf({ status: 401, body: { error: 'Gone.' } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const reply = await ports.readEvents(
      RUN_ID,
      0,
      20,
      new AbortController().signal,
    );

    expect(reply.status).toBe(401);
    expect(await reply.json()).toEqual({ error: 'Gone.' });
  });
});

/** One character outside the first plane, which takes two units in a string. */
const ASTRAL = '\u{1d538}';

describe('createNextPorts, the check of a text', () => {
  const finding = {
    code: 'UNKNOWN_KEY',
    severity: 'warning',
    file: 'hello.yml',
    path: 'stages[0].nope',
    line: 2,
    column: 3,
    end_line: 2,
    end_column: 7,
    message: 'A key.',
  };
  const stage = {
    name: 'draft',
    kind: 'agent',
    agent: 'k-developer',
    prompt: 'Write it.',
    range: { line: 7, end_line: 8 },
  };
  const answer = {
    view: {
      format: 'konductor/1',
      version: '0.1.0',
      name: 'hello',
      intent: { outcome: 'Add a greeting' },
      stages: [stage],
    },
    diagnostics: [finding],
  };

  it('sends the text and counts what the check found', async () => {
    const { calls, fetchFn } = serverOf({ body: answer });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { name: 'hello', text: 'format: konductor/1\n' },
      new AbortController().signal,
    );

    expect(calls[0]?.path).toBe('/api/validate');
    expect(calls[0]?.init.method).toBe('POST');
    expect(checked.errors).toBe(0);
    expect(checked.warnings).toBe(1);
    expect(checked.view?.stages[0]?.range).toEqual({ line: 7, end_line: 8 });
    expect(checked.view?.stages[0]?.prompt).toBe('Write it.');
  });

  it('reads a view with the keys the contract leaves room for', async () => {
    const view = {
      ...answer.view,
      params: { tone: { type: 'string' } },
      stages: [{ ...stage, done_when: ['draft-exists'], surprise: 7 }],
      surprise: 'a key of a later release',
    };
    const { fetchFn } = serverOf({ body: { view, diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    // The keys of the answer come through as they came, at the top of the
    // view and on a stage alike; the fields this page reads are checked.
    expect(checked.view?.params).toEqual({ tone: { type: 'string' } });
    expect(checked.view?.surprise).toBe('a key of a later release');
    expect(checked.view?.intent).toEqual({ outcome: 'Add a greeting' });
    expect(checked.view?.stages[0]?.done_when).toEqual(['draft-exists']);
    expect(checked.view?.stages[0]?.surprise).toBe(7);
    expect(checked.view?.stages).toHaveLength(1);
  });

  it('reads an outcome of 300 characters outside the first plane', async () => {
    // The contract counts characters, which are code points: these take two
    // units each in a JavaScript string, and the reply is within the limit.
    const outcome = ASTRAL.repeat(300);
    expect(outcome.length).toBe(600);
    const view = { ...answer.view, intent: { outcome } };
    const { fetchFn } = serverOf({ body: { view, diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    expect(checked.view?.intent).toEqual({ outcome });
  });

  it('reads an intent with the longest outcome the contract allows', async () => {
    const outcome = 'a'.repeat(300);
    const view = { ...answer.view, intent: { outcome, accept: [] } };
    const { fetchFn } = serverOf({ body: { view, diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    // Every other key of the intent comes through with it.
    expect(checked.view?.intent).toEqual({ outcome, accept: [] });
  });

  it('reads a view with as many stages as a workflow may have', async () => {
    const stages = Array.from({ length: 40 }, (_one, index) => ({
      ...stage,
      name: `stage-${index}`,
    }));
    const { fetchFn } = serverOf({
      body: { view: { ...answer.view, stages }, diagnostics: [] },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    expect(checked.view?.stages).toHaveLength(40);
  });

  it('takes a severity it does not know as an error', async () => {
    const { fetchFn } = serverOf({
      body: {
        view: null,
        diagnostics: [{ ...finding, severity: 'fatal' }],
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    expect(checked.errors).toBe(1);
    expect(checked.view).toBeNull();
  });

  it('refuses a reply that leaves the view out', async () => {
    const { fetchFn } = serverOf({ body: { diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.validate({ text: '' }, new AbortController().signal),
    ).rejects.toThrow(ApiError);
  });

  it('takes a view that is null as the answer of a text with errors', async () => {
    const { fetchFn } = serverOf({ body: { view: null, diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const checked = await ports.validate(
      { text: '' },
      new AbortController().signal,
    );

    expect(checked.view).toBeNull();
  });

  it('refuses a reply with no findings in it', async () => {
    const { fetchFn } = serverOf({ body: { view: null } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.validate({ text: '' }, new AbortController().signal),
    ).rejects.toThrow(ApiError);
  });

  // Every field the contract requires of a stage, left out one at a time.
  const without = (key: keyof typeof stage) => {
    const rest: Record<string, unknown> = { ...stage };
    delete rest[key];
    return { ...answer.view, stages: [rest] };
  };

  it.each([
    ['a view with no stages', { format: 'konductor/1' }],
    ['stages that are not a list', { ...answer.view, stages: 'draft' }],
    ['a stage with no name', without('name')],
    ['a stage with no kind', without('kind')],
    ['a stage with no agent', without('agent')],
    ['a stage with no range', without('range')],
    [
      'a stage whose kind is not text',
      { ...answer.view, stages: [{ ...stage, kind: 7 }] },
    ],
    [
      'a stage whose agent is not text',
      { ...answer.view, stages: [{ ...stage, agent: 7 }] },
    ],
    [
      'a stage range that is not a mapping',
      { ...answer.view, stages: [{ ...stage, range: 'lines 1 to 2' }] },
    ],
    [
      'a stage range that ends before it starts',
      {
        ...answer.view,
        stages: [{ ...stage, range: { line: 9, end_line: 8 } }],
      },
    ],
    ['a view with no name', { ...answer.view, name: 7 }],
    ['a view with no format', { ...answer.view, format: undefined }],
    ['a view with no version', { ...answer.view, version: undefined }],
    ['a view with no intent', { ...answer.view, intent: undefined }],
    [
      'a view whose intent is not a mapping',
      { ...answer.view, intent: 'Ship' },
    ],
    ['an intent with no outcome', { ...answer.view, intent: { accept: [] } }],
    [
      'an intent whose outcome is not text',
      { ...answer.view, intent: { outcome: 7 } },
    ],
    [
      'an intent whose outcome is empty',
      { ...answer.view, intent: { outcome: '' } },
    ],
    [
      'an intent whose outcome is longer than the contract allows',
      { ...answer.view, intent: { outcome: 'a'.repeat(301) } },
    ],
    [
      'an intent of 301 characters outside the first plane',
      { ...answer.view, intent: { outcome: ASTRAL.repeat(301) } },
    ],
    [
      'an intent whose outcome runs over two lines',
      { ...answer.view, intent: { outcome: 'Add a greeting\nto the README' } },
    ],
    ['a view with no stage at all', { ...answer.view, stages: [] }],
    [
      'a view with more stages than a workflow may have',
      {
        ...answer.view,
        stages: Array.from({ length: 41 }, (_one, index) => ({
          ...stage,
          name: `stage-${index}`,
        })),
      },
    ],
  ])('refuses %s', async (_, view) => {
    const { fetchFn } = serverOf({ body: { view, diagnostics: [] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.validate({ text: '' }, new AbortController().signal),
    ).rejects.toThrow(ApiError);
  });

  it.each([
    ['no message', { ...finding, message: undefined }],
    ['no code', { ...finding, code: undefined }],
    ['no file', { ...finding, file: undefined }],
    ['no path', { ...finding, path: undefined }],
    ['no line', { ...finding, line: undefined }],
    ['a line of 0', { ...finding, line: 0 }],
    ['no end column', { ...finding, end_column: undefined }],
    ['a column that is not whole', { ...finding, column: 1.5 }],
  ])('refuses a finding with %s', async (_, one) => {
    const { fetchFn } = serverOf({ body: { view: null, diagnostics: [one] } });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(
      ports.validate({ text: '' }, new AbortController().signal),
    ).rejects.toThrow(ApiError);
  });
});

describe('createNextPorts, when a call cannot be made', () => {
  it('says so without a session', async () => {
    const { calls, fetchFn } = serverOf({ body: DOCUMENT });
    const ports = createNextPorts(undefined, { fetchFn });

    await expect(ports.loadExtras()).rejects.toThrow(/no session/i);
    expect(calls).toEqual([]);
  });

  it('holds the token of the workflow it was built for', async () => {
    const { calls, fetchFn } = serverOf({ body: DOCUMENT });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await ports.loadExtras();
    await ports.loadExtras();

    expect(calls.map((call) => headerOf(call))).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
  });

  it('tells the page once when the server no longer knows the session', async () => {
    const { fetchFn } = serverOf({
      status: 401,
      body: { error: 'The session is gone.' },
    });
    const lost = vi.fn();
    const ports = createNextPorts(TOKEN, { fetchFn, onSessionLost: lost });

    await expect(ports.loadExtras()).rejects.toThrow(/no longer knows/);
    await expect(ports.listAgents()).rejects.toThrow(/no longer knows/);

    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('does not take a 403 for a session that is gone', async () => {
    const { fetchFn } = serverOf({
      status: 403,
      body: { error: 'This session may not read the workflow.' },
    });
    const lost = vi.fn();
    const ports = createNextPorts(TOKEN, { fetchFn, onSessionLost: lost });

    await expect(ports.loadExtras()).rejects.toThrow('may not read');

    expect(lost).not.toHaveBeenCalled();
  });

  it('passes on what the server said about the refusal', async () => {
    const { fetchFn } = serverOf({
      status: 403,
      body: { error: 'This session may not read the workflow.' },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.loadExtras()).rejects.toThrow(
      'This session may not read the workflow.',
    );
  });

  it('keeps the fix of an error, which says what to do about it', async () => {
    const { fetchFn } = serverOf({
      status: 409,
      body: {
        error: 'The workflow is not trusted.',
        fix: 'Run flow trust and open the address again.',
        code: 'trust_required',
      },
    });
    const ports = createNextPorts(TOKEN, { fetchFn });

    const failed = await ports.loadExtras().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(ApiError);
    expect((failed as ApiError).message).toBe(
      'The workflow is not trusted. Run flow trust and open the address again.',
    );
    expect((failed as ApiError).code).toBe('trust_required');
  });

  it('says the server did not answer when the call fails', async () => {
    const fetchFn = vi.fn(() =>
      Promise.reject(new TypeError('network error')),
    ) as unknown as typeof fetch;
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.loadExtras()).rejects.toThrow(/did not answer/);
  });

  it('counts a body that is not JSON as a reply it cannot read', async () => {
    const { fetchFn } = serverOf({ text: 'not json' });
    const ports = createNextPorts(TOKEN, { fetchFn });

    await expect(ports.loadExtras()).rejects.toThrow(ApiError);
  });
});
