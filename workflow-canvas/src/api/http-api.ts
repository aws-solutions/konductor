// SPDX-License-Identifier: Apache-2.0
import { ApiError, type WorkflowApi } from './api';
import {
  errorCodeOf,
  errorMessageOf,
  parseRunStarted,
  parseRunStatus,
  parseSession,
  parseWorkflowDocument,
} from './parse';

type Fetch = typeof fetch;

const UNREACHABLE =
  'The server did not answer. Check that it is still running.';

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function send(
  fetchFn: Fetch,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(path, init);
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
  const body = await bodyOf(response);
  if (response.ok) return body;
  throw new ApiError(
    errorMessageOf(body) ?? `The server answered ${response.status}.`,
    response.status,
    errorCodeOf(body),
  );
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * The adapter of the workflow API over HTTP. It calls the relative `/api`, so
 * the page and the server share one origin, and keeps no token itself.
 */
export function createHttpApi(fetchFn: Fetch = fetch): WorkflowApi {
  return {
    async createSession(code) {
      const body = await send(fetchFn, '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      return parseSession(body);
    },
    async getWorkflow(token) {
      const body = await send(fetchFn, '/api/workflow', {
        headers: bearer(token),
      });
      return parseWorkflowDocument(body);
    },
    async startRun(token, goal) {
      const body = await send(fetchFn, '/api/run', {
        method: 'POST',
        headers: { ...bearer(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { goal } }),
      });
      return parseRunStarted(body);
    },
    async getRun(token, runId) {
      const body = await send(
        fetchFn,
        `/api/runs/${encodeURIComponent(runId)}`,
        {
          headers: bearer(token),
        },
      );
      return parseRunStatus(body);
    },
  };
}
