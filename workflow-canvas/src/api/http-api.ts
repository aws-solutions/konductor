// SPDX-License-Identifier: Apache-2.0
import { ApiError, type WorkflowApi } from './api';
import {
  errorCodeOf,
  errorCurrentHashOf,
  errorDiagnosticsOf,
  errorMessageOf,
  errorRunIdOf,
  parseCheckResult,
  parseRunStarted,
  parseRunStatus,
  parseSaveResult,
  parseSession,
  parseWorkflowDocument,
} from './parse';

type Fetch = typeof fetch;

const UNREACHABLE =
  'The server did not answer. Check that it is still running.';

const ACCEPTED_STATUS = 202;
const RUN_ACCEPTED_UNREADABLE =
  'The server accepted the run, but its reply could not be read. The run may have started.';

/** How long a call may take before the page gives up on it. */
export const REQUEST_TIMEOUT_MS = 15_000;

// A body that is not JSON is `undefined`. Any other failure to read it, such
// as a connection that dropped or a timeout, is thrown.
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    // Text that is not JSON is a bad reply. A body that stopped arriving is
    // not a reply at all, so it counts as no answer.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

// Gives the call a signal that aborts after the timeout or when `outer`
// aborts. The body is read inside the call, so a hung body is covered, and the
// timer and the listener never outlive the call.
async function withTimeout<T>(
  timeoutMs: number | undefined,
  outer: AbortSignal | undefined,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer =
    timeoutMs === undefined ? undefined : setTimeout(abort, timeoutMs);
  if (outer?.aborted) abort();
  outer?.addEventListener('abort', abort, { once: true });
  try {
    return await call(controller.signal);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outer?.removeEventListener('abort', abort);
  }
}

async function exchange(
  fetchFn: Fetch,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetchFn(path, { ...init, signal });
  return { response, body: await bodyOf(response) };
}

async function send(
  fetchFn: Fetch,
  timeoutMs: number | undefined,
  path: string,
  init: RequestInit,
  outer?: AbortSignal,
): Promise<unknown> {
  let reply: { response: Response; body: unknown };
  try {
    reply = await withTimeout(timeoutMs, outer, (signal) =>
      exchange(fetchFn, path, init, signal),
    );
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
  const { response, body } = reply;
  if (response.ok) return body;
  throw new ApiError(
    errorMessageOf(body) ?? `The server answered ${response.status}.`,
    response.status,
    errorCodeOf(body),
    errorRunIdOf(body),
    errorDiagnosticsOf(body),
    errorCurrentHashOf(body),
  );
}

// The server accepted the run, so a reply that cannot be read does not mean
// that the run did not start.
function acceptedRunId(body: unknown): string {
  try {
    return parseRunStarted(body);
  } catch {
    throw new ApiError(RUN_ACCEPTED_UNREADABLE, ACCEPTED_STATUS);
  }
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token?: string): Record<string, string> {
  return {
    ...(token === undefined ? {} : bearer(token)),
    'Content-Type': 'application/json',
  };
}

/**
 * The adapter of the workflow API over HTTP. It calls the relative `/api`, so
 * the page and the server share one origin, and keeps no token itself.
 */
export function createHttpApi(
  fetchFn: Fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
): WorkflowApi {
  const call = (path: string, init: RequestInit, signal?: AbortSignal) =>
    send(fetchFn, timeoutMs, path, init, signal);
  return {
    async createSession(code) {
      // No timeout: the launch code works once, so giving up on a slow answer
      // after the server has traded it would leave the page with no way in.
      const body = await send(fetchFn, undefined, '/api/session', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ code }),
      });
      return parseSession(body);
    },
    async getWorkflow(token) {
      const body = await call('/api/workflow', {
        headers: bearer(token),
      });
      return parseWorkflowDocument(body);
    },
    async saveWorkflow(token, text, baseHash) {
      const body = await call('/api/workflow', {
        method: 'PUT',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text, base_hash: baseHash }),
      });
      return parseSaveResult(body);
    },
    async checkWorkflow(token, text) {
      const body = await call('/api/validate', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ text }),
      });
      return parseCheckResult(body);
    },
    async startRun(token, goal, signal) {
      const body = await call(
        '/api/run',
        {
          method: 'POST',
          headers: { ...bearer(token), 'Content-Type': 'application/json' },
          body: JSON.stringify({ params: { goal } }),
        },
        signal,
      );
      return acceptedRunId(body);
    },
    async getRun(token, runId, signal) {
      const body = await call(
        `/api/runs/${encodeURIComponent(runId)}`,
        { headers: bearer(token) },
        signal,
      );
      return parseRunStatus(body);
    },
  };
}
