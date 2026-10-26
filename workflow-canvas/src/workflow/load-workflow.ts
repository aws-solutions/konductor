// SPDX-License-Identifier: Apache-2.0
import { ApiError, canRetryStatus, type WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';
import {
  RunAlreadyActive,
  RunReadRefused,
  type RunPort,
} from '../execution/core';

/**
 * A workflow loaded from the server, with the harness that runs its stages
 * and the calls that run it. The calls hold the session token, so no other
 * part of the page does.
 */
export interface LoadedWorkflow {
  harness: string;
  document: WorkflowDocument;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The workflow did not load.';
}

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
    ? new RunReadRefused(error.message)
    : undefined;
}

function runPortFor(api: WorkflowApi, token: string): RunPort {
  return {
    start: async (goal) => {
      try {
        return await api.startRun(token, goal);
      } catch (error) {
        throw activeRunOf(error) ?? error;
      }
    },
    get: async (runId) => {
      try {
        return await api.getRun(token, runId);
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
        runs: runPortFor(api, session.token),
      },
    };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** The name of the workflow that a load drew, or `undefined` if none is open. */
export function openWorkflowName(
  result: LoadResult | undefined,
): string | undefined {
  return result?.ok ? result.workflow.document.view?.name : undefined;
}
