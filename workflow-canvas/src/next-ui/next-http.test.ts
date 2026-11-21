// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import { createNextPorts } from './next-http';

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
