// SPDX-License-Identifier: Apache-2.0
import type { WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';

/** A workflow loaded from the server, with the harness that runs its stages. */
export interface LoadedWorkflow {
  harness: string;
  document: WorkflowDocument;
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

/**
 * Opens a session with the launch code, then loads the workflow of the
 * session. The token stays in this function and is not kept.
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
    return { ok: true, workflow: { harness: session.harness, document } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
