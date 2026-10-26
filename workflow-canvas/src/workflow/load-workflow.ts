// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';
import type { RunPort } from '../execution/core';

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

function runPortFor(api: WorkflowApi, token: string): RunPort {
  return {
    start: (goal) => api.startRun(token, goal),
    get: (runId) => api.getRun(token, runId),
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
