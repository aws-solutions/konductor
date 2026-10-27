// SPDX-License-Identifier: Apache-2.0
import { ApiError, type WorkflowApi } from './api';
import {
  errorCodeOf,
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

/** How long a call may take before the page gives up on it. */
export const REQUEST_TIMEOUT_MS = 15_000;

// A body that cannot be read as JSON is `undefined`; a read that the timeout
// aborted is an error, so a hung body is not taken for a bad reply.
async function bodyOf(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

// Gives the call a signal that aborts after the timeout; the reading of the
// body is covered too, and the timer never outlives the call.
async function withTimeout<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await call(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function exchange(
  fetchFn: Fetch,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetchFn(path, { ...init, signal });
  return { response, body: await bodyOf(response, signal) };
}

async function send(
  fetchFn: Fetch,
  timeoutMs: number,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let reply: { response: Response; body: unknown };
  try {
    reply = await withTimeout(timeoutMs, (signal) =>
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
  );
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
  const call = (path: string, init: RequestInit) =>
    send(fetchFn, timeoutMs, path, init);
  return {
    async createSession(code) {
      const body = await call('/api/session', {
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
    async startRun(token, goal) {
      const body = await call('/api/run', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ params: { goal } }),
      });
      return parseRunStarted(body);
    },
    async getRun(token, runId) {
      const body = await call(`/api/runs/${encodeURIComponent(runId)}`, {
        headers: bearer(token),
      });
      return parseRunStatus(body);
    },
  };
}
