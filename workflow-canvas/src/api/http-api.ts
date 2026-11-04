// SPDX-License-Identifier: Apache-2.0
import { ApiError, type WorkflowApi } from './api';
import {
  errorCodeOf,
  errorMessageOf,
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
        headers: { Authorization: `Bearer ${token}` },
      });
      return parseWorkflowDocument(body);
    },
  };
}
