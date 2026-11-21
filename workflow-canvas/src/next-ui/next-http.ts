// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../api/api';
import {
  parseWorkflowExtras,
  type WorkflowExtras,
} from '../api/workflow-extras';
import type { AgentOption } from '../designer-view/field-rules';
import type { CheckAnswer, CheckRequest } from '../designer-view/yaml-draft';
import type { RunSummaryRow } from '../execution/core/run-history';
import type { ReadEvents } from '../run-client/follow-run-events';
import { runEventsPath } from '../run-client/follow-run-events';
import type { ListRuns } from '../run-view/use-run-history';

/*
 * The calls that the views being built need and the page's API client does
 * not have yet: the extra fields of the workflow, the agents, the past runs,
 * the events of a run and a check of a text that keeps the lines of each
 * stage. They talk to the relative `/api`, as the client does, so the page
 * and the server share one origin.
 */

type Fetch = typeof fetch;

const UNREACHABLE =
  'The server did not answer. Check that it is still running.';

const BAD_REPLY = 'The server sent a reply that this page does not understand.';

const NO_SESSION =
  'The page has no session with the server. Reload it with a fresh launch address.';

const SESSION_UNKNOWN =
  'The server no longer knows this session. It may have been started again. Get a fresh launch address from the server. An address works once.';

/** The status that says the server no longer knows the session. */
const SESSION_LOST_STATUS = 401;

/** How long one of these calls may take before the page gives up on it. */
export const NEXT_REQUEST_TIMEOUT_MS = 15_000;

/** The calls that the Design and Run views make, beyond the session's own. */
export interface NextPorts {
  /** Reads the `kind`, `range`, `stage_fields` and default goal of the workflow. */
  readonly loadExtras: (signal?: AbortSignal) => Promise<WorkflowExtras>;
  /** The agents a stage may name, as `GET /api/agents` lists them. */
  readonly listAgents: (
    signal?: AbortSignal,
  ) => Promise<readonly AgentOption[]>;
  readonly listRuns: ListRuns;
  readonly readEvents: ReadEvents;
  /** Checks a text and keeps the lines of each stage of its view. */
  readonly validate: (
    request: CheckRequest,
    signal: AbortSignal,
  ) => Promise<CheckAnswer>;
}

/** The session token of the page, or `undefined` while there is none. */
export type TokenSource = () => string | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(body: unknown, status: number): string {
  const error = isObject(body) ? body.error : undefined;
  return typeof error === 'string' && error !== ''
    ? error
    : `The server answered ${status}.`;
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    // Text that is not JSON is a bad reply; a body that stopped arriving is
    // no reply at all, so it counts as no answer.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

// Gives the call a signal that aborts after the timeout or when `outer` does,
// and leaves no timer or listener behind.
async function withTimeout<T>(
  outer: AbortSignal | undefined,
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (outer?.aborted) abort();
  outer?.addEventListener('abort', abort, { once: true });
  try {
    return await call(controller.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

function agentOf(value: unknown): AgentOption {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const { id, summary } = value;
  if (typeof id !== 'string' || typeof summary !== 'string') {
    throw new ApiError(BAD_REPLY, 200);
  }
  return { id, summary };
}

function agentsOf(body: unknown): readonly AgentOption[] {
  const agents = isObject(body) ? body.agents : undefined;
  if (!Array.isArray(agents)) throw new ApiError(BAD_REPLY, 200);
  return agents.map(agentOf);
}

const RUN_STATUSES: ReadonlySet<unknown> = new Set([
  'running',
  'passed',
  'halted',
]);

function runOf(value: unknown): RunSummaryRow {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const { run_id: runId, started_at: startedAt, status, goal } = value;
  const truncated = value.goal_truncated;
  if (
    typeof runId !== 'string' ||
    typeof startedAt !== 'string' ||
    typeof goal !== 'string' ||
    typeof truncated !== 'boolean' ||
    !RUN_STATUSES.has(status)
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return {
    run_id: runId,
    started_at: startedAt,
    status: status as RunSummaryRow['status'],
    goal,
    goal_truncated: truncated,
  };
}

function runsOf(body: unknown): readonly RunSummaryRow[] {
  const runs = isObject(body) ? body.runs : undefined;
  if (!Array.isArray(runs)) throw new ApiError(BAD_REPLY, 200);
  return runs.map(runOf);
}

const SEVERITIES = ['error', 'warning', 'info'] as const;

type Severity = (typeof SEVERITIES)[number];

function isWholeAtLeast(value: unknown, least: number): value is number {
  return Number.isInteger(value) && (value as number) >= least;
}

function textOrFail(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(BAD_REPLY, 200);
  return value;
}

// A severity a later release adds is taken as an error, so a finding this
// page cannot judge never reads as harmless. Every other field the contract
// requires must be there, `file` included, though no view shows it: a reply
// that leaves one out is one this page does not understand.
function diagnosticOf(value: unknown): CheckAnswer['diagnostics'][number] {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const severity = SEVERITIES.find((known) => known === value.severity);
  const places = ['line', 'column', 'end_line', 'end_column'] as const;
  for (const place of places) {
    if (!isWholeAtLeast(value[place], 1)) throw new ApiError(BAD_REPLY, 200);
  }
  textOrFail(value.file);
  return {
    code: textOrFail(value.code),
    severity: severity ?? ('error' as Severity),
    path: textOrFail(value.path),
    line: value.line as number,
    column: value.column as number,
    end_line: value.end_line as number,
    end_column: value.end_column as number,
    message: textOrFail(value.message),
    ...(typeof value.suggestion === 'string'
      ? { suggestion: value.suggestion }
      : {}),
  };
}

// One stage of the view: the `name`, `kind`, `agent` and `range` that the
// contract requires, with `kind` and `range` being what the Design view
// draws it by. Every other key is kept as it came, because the form shows
// the keys of the file.
function viewStageOf(
  value: unknown,
): CheckAnswer['view'] extends null
  ? never
  : NonNullable<CheckAnswer['view']>['stages'][number] {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const name = textOrFail(value.name);
  textOrFail(value.kind);
  textOrFail(value.agent);
  const range = value.range;
  if (
    !isObject(range) ||
    !isWholeAtLeast(range.line, 1) ||
    !isWholeAtLeast(range.end_line, 1) ||
    (range.end_line as number) < (range.line as number)
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return { ...value, name };
}

// The parsed workflow of the answer. `parse.ts` has `parseCheckResult` for
// this body, but it drops the `kind` and the `range` of a stage, which the
// Design view draws and marks by, so the fields are read here instead. The
// contract requires the field, and allows it to be null, which is what a
// text with errors answers with; a body that leaves it out altogether is a
// reply this page does not understand.
function checkViewOf(value: unknown): CheckAnswer['view'] {
  if (value === null) return null;
  if (!isObject(value) || !Array.isArray(value.stages)) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return {
    format: textOrFail(value.format),
    version: textOrFail(value.version),
    name: textOrFail(value.name),
    intent: value.intent,
    stages: value.stages.map(viewStageOf),
  };
}

function countOf(
  diagnostics: readonly { severity: string }[],
  of: Severity,
): number {
  return diagnostics.filter((one) => one.severity === of).length;
}

/**
 * The answer of `POST /api/validate`, with every field the views read: the
 * stages of the view with their lines, and the place and sentence of each
 * finding. A field the contract shapes differently is a reply this page does
 * not understand, so the view says so instead of drawing it.
 */
function checkAnswerOf(body: unknown): CheckAnswer {
  if (!isObject(body) || !Array.isArray(body.diagnostics)) {
    throw new ApiError(BAD_REPLY, 200);
  }
  if (!('view' in body)) throw new ApiError(BAD_REPLY, 200);
  const findings = body.diagnostics.map(diagnosticOf);
  return {
    errors: countOf(findings, 'error'),
    warnings: countOf(findings, 'warning'),
    infos: countOf(findings, 'info'),
    view: checkViewOf(body.view),
    diagnostics: findings,
  };
}

/**
 * Builds the calls of the views being built for one loaded workflow. The
 * token is the one that workflow was loaded with, read once and held here,
 * so a session opened later, or one that is still waiting for its first
 * load, is never addressed by these calls. Each loaded workflow gets its own
 * object, which the hooks of the views use to tell one workflow from another.
 *
 * A 401 is the guard of the session: the server no longer knows it, so
 * `onSessionLost` is told, once, and the call fails with a sentence fit to
 * show. Any other refusal carries the server's own sentence.
 */
export function createNextPorts(
  token: string | undefined,
  {
    fetchFn = fetch,
    timeoutMs = NEXT_REQUEST_TIMEOUT_MS,
    onSessionLost,
  }: {
    readonly fetchFn?: Fetch;
    readonly timeoutMs?: number;
    /** Called the first time a call of this session is answered with 401. */
    readonly onSessionLost?: () => void;
  } = {},
): NextPorts {
  let lost = false;
  const sessionLost = (): never => {
    if (!lost) {
      lost = true;
      onSessionLost?.();
    }
    throw new ApiError(SESSION_UNKNOWN, 401);
  };
  const headers = () => {
    if (token === undefined) throw new ApiError(NO_SESSION, 401);
    return { Authorization: `Bearer ${token}` };
  };
  const send = async (
    path: string,
    init: RequestInit,
    outer: AbortSignal | undefined,
  ): Promise<unknown> => {
    const auth = headers();
    let reply: { response: Response; body: unknown };
    try {
      reply = await withTimeout(outer, timeoutMs, async (signal) => {
        const response = await fetchFn(path, {
          ...init,
          signal,
          headers: { ...init.headers, ...auth },
        });
        return { response, body: await bodyOf(response) };
      });
    } catch {
      throw new ApiError(UNREACHABLE, 0);
    }
    const { response, body } = reply;
    if (response.ok) return body;
    if (response.status === SESSION_LOST_STATUS) sessionLost();
    throw new ApiError(messageOf(body, response.status), response.status);
  };
  return {
    loadExtras: async (signal) =>
      parseWorkflowExtras(await send('/api/workflow', {}, signal)),
    listAgents: async (signal) =>
      agentsOf(await send('/api/agents', {}, signal)),
    listRuns: async (signal) => runsOf(await send('/api/runs', {}, signal)),
    // The long poll holds the call open, so the follower's own limit times it
    // and this one does not: it reads the reply as the follower expects.
    readEvents: async (runId, after, wait, signal) => {
      const auth = headers();
      const response = await fetchFn(runEventsPath(runId, after, wait), {
        headers: auth,
        signal,
      });
      if (response.status === SESSION_LOST_STATUS && !lost) {
        lost = true;
        onSessionLost?.();
      }
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
      };
    },
    validate: async (request, signal) =>
      checkAnswerOf(
        await send(
          '/api/validate',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          },
          signal,
        ),
      ),
  };
}
