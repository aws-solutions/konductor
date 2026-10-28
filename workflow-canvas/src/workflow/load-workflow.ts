// SPDX-License-Identifier: Apache-2.0
import { ApiError, canRetryStatus, type WorkflowApi } from '../api/api';
import { messageOf } from '../api/message-of';
import type { WorkflowDocument } from '../api/types';
import {
  SaveConflict,
  SaveLost,
  SaveRefused,
  type EditPort,
} from '../designer/core';
import {
  RunAlreadyActive,
  RunReadRefused,
  RunStartUnsure,
  type RunPort,
} from '../execution/core';

/**
 * A workflow loaded from the server, with the harness that runs its stages
 * and the calls that edit and run it. The calls hold the session token, so no
 * other part of the page does.
 */
export interface LoadedWorkflow {
  harness: string;
  document: WorkflowDocument;
  edits: EditPort;
  runs: RunPort;
}

/** The result of a load. It never rejects, so a caller cannot miss a failure. */
export type LoadResult =
  { ok: true; workflow: LoadedWorkflow } | { ok: false; message: string };

const NO_LAUNCH_CODE =
  'There is no launch code in the address. Open the launch address that the server printed; it ends in #<launch code>.';

/** The major version of the API that this page reads. */
export const SUPPORTED_API_VERSION = 1;

const UNSUPPORTED_API =
  'The server speaks a version of the API that this page does not understand.';

const LOAD_FAILED = 'The workflow did not load.';

// The API names the active run in its 409; the core is told as its own error.
function activeRunOf(error: unknown): RunAlreadyActive | undefined {
  return error instanceof ApiError &&
    error.code === 'already_running' &&
    error.runId !== undefined
    ? new RunAlreadyActive(error.message, error.runId)
    : undefined;
}

// Only a missing answer or a server error can be gone on the next try; any
// 4xx and a reply the page cannot read will not change.
function readRefusedOf(error: unknown): RunReadRefused | undefined {
  return error instanceof ApiError && !canRetryStatus(error.status)
    ? new RunReadRefused(messageOf(error, error.message))
    : undefined;
}

// No answer, or an accepted run in a reply the page cannot read: the run may
// have started.
function startUnsureOf(error: unknown): RunStartUnsure | undefined {
  return error instanceof ApiError &&
    (error.status === 0 || error.status === 202)
    ? new RunStartUnsure(error.message)
    : undefined;
}

// A 409 `conflict` is the file changing under the page; a 422
// `invalid_workflow` carries the findings of the check; no answer or a server
// error leaves it unknown whether the file was written. The core is told each
// as its own error.
function saveErrorOf(error: unknown): Error | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'conflict') return new SaveConflict(error.message);
  if (error.code === 'invalid_workflow') {
    return new SaveRefused(error.message, error.diagnostics);
  }
  return canRetryStatus(error.status)
    ? new SaveLost(messageOf(error, error.message))
    : undefined;
}

function editPortFor(api: WorkflowApi, token: string): EditPort {
  return {
    save: async (text, baseHash) => {
      try {
        return await api.saveWorkflow(token, text, baseHash);
      } catch (error) {
        throw saveErrorOf(error) ?? error;
      }
    },
    check: (text) => api.checkWorkflow(token, text),
    reload: () => api.getWorkflow(token),
  };
}

function runPortFor(api: WorkflowApi, token: string): RunPort {
  return {
    start: async (goal, signal) => {
      try {
        return await api.startRun(token, goal, signal);
      } catch (error) {
        throw activeRunOf(error) ?? startUnsureOf(error) ?? error;
      }
    },
    get: async (runId, signal) => {
      try {
        return await api.getRun(token, runId, signal);
      } catch (error) {
        throw readRefusedOf(error) ?? error;
      }
    },
  };
}

/**
 * Opens a session with the launch code, then loads the workflow of the
 * session. The token is kept only inside the run calls of the result.
 */
export async function loadWorkflow(
  api: WorkflowApi,
  launchCode: string | undefined,
): Promise<LoadResult> {
  if (launchCode === undefined) return { ok: false, message: NO_LAUNCH_CODE };
  try {
    const session = await api.createSession(launchCode);
    if (session.apiVersion !== SUPPORTED_API_VERSION) {
      return { ok: false, message: UNSUPPORTED_API };
    }
    const document = await api.getWorkflow(session.token);
    return {
      ok: true,
      workflow: {
        harness: session.harness,
        document,
        edits: editPortFor(api, session.token),
        runs: runPortFor(api, session.token),
      },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error, LOAD_FAILED) };
  }
}

/** The name of the workflow that a load drew, or `undefined` if none is open. */
export function openWorkflowName(
  result: LoadResult | undefined,
): string | undefined {
  return result?.ok ? result.workflow.document.view?.name : undefined;
}

/**
 * The same result with another document, such as the one that was saved. A
 * failed load, or no result yet, stays as it is.
 */
export function withDocument(
  result: LoadResult | undefined,
  document: WorkflowDocument,
): LoadResult | undefined {
  return result?.ok
    ? { ok: true, workflow: { ...result.workflow, document } }
    : result;
}
