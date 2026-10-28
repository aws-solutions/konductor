// SPDX-License-Identifier: Apache-2.0
import { ApiError, canRetryStatus, type WorkflowApi } from '../api/api';
import {
  isSessionLost,
  lostSessionMessage,
  messageOf,
} from '../api/message-of';
import type { WorkflowDocument } from '../api/types';
import {
  SaveConflict,
  SaveLost,
  SaveRefused,
  SessionLost,
  type EditPort,
} from '../designer/core';
import {
  RunAlreadyActive,
  RunReadRefused,
  RunStartUnsure,
  type RunPort,
} from '../execution/core';
import type { SessionMemory, SessionRecord } from '../launch/session-memory';

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

/**
 * The result of a load. It never rejects, so a caller cannot miss a failure.
 * `remember` keeps the session for a reload; the page calls it once it shows
 * the workflow, so a load that is not shown does not replace the kept session.
 */
export type LoadResult =
  | { ok: true; workflow: LoadedWorkflow; remember: () => void }
  | { ok: false; message: string };

const NO_LAUNCH_CODE =
  'There is no launch code in the address. Open the launch address that the server printed; it ends in #<launch code>.';

const SESSION_UNKNOWN =
  'The server no longer knows this session. It may have been started again. Open the launch address that it printed; it ends in #<launch code>.';

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

// A new session is a new page, which has no draft.
const CHANGES_ARE_LOST =
  'The changes you made on this page are lost when you do; copy them first.';

function lostSessionSentence(error: ApiError): string {
  return `${lostSessionMessage(error)} ${CHANGES_ARE_LOST}`;
}

// A 401 on a check: the core is told as its own error.
function checkErrorOf(error: unknown): SessionLost | undefined {
  return error instanceof ApiError && isSessionLost(error)
    ? new SessionLost(lostSessionSentence(error))
    : undefined;
}

// A 2xx whose body the page cannot read: the server did the write.
function isUnreadableSuccess(error: ApiError): boolean {
  return error.status >= 200 && error.status < 300;
}

// A 409 `conflict` is the file changing under the page; a 422
// `invalid_workflow` carries the findings of the check; no answer or a server
// error leaves it unknown whether the file was written. The core is told each
// as its own error.
function saveErrorOf(error: unknown): Error | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'conflict') {
    return new SaveConflict(error.message, error.currentHash);
  }
  if (error.code === 'invalid_workflow') {
    return new SaveRefused(error.message, error.diagnostics);
  }
  if (isSessionLost(error)) {
    return new Error(lostSessionSentence(error));
  }
  return canRetryStatus(error.status) || isUnreadableSuccess(error)
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
    check: async (text) => {
      try {
        return await api.checkWorkflow(token, text);
      } catch (error) {
        throw checkErrorOf(error) ?? error;
      }
    },
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

function failure(message: string): LoadResult {
  return { ok: false, message };
}

async function loadWith(
  api: WorkflowApi,
  session: SessionRecord,
  memory: SessionMemory,
): Promise<LoadResult> {
  const document = await api.getWorkflow(session.token);
  return {
    ok: true,
    workflow: {
      harness: session.harness,
      document,
      edits: editPortFor(api, session.token),
      runs: runPortFor(api, session.token),
    },
    remember: () => memory.remember(session),
  };
}

async function openWithCode(
  api: WorkflowApi,
  launchCode: string,
  memory: SessionMemory,
): Promise<LoadResult> {
  try {
    const { token, harness, apiVersion } = await api.createSession(launchCode);
    if (apiVersion !== SUPPORTED_API_VERSION) return failure(UNSUPPORTED_API);
    return await loadWith(api, { token, harness }, memory);
  } catch (error) {
    return failure(messageOf(error, LOAD_FAILED));
  }
}

// Forgets the token only if no newer session was kept while this one loaded.
function forgetIfStill(memory: SessionMemory, session: SessionRecord): void {
  if (memory.recall()?.token === session.token) memory.forget();
}

async function resume(
  api: WorkflowApi,
  session: SessionRecord,
  memory: SessionMemory,
): Promise<LoadResult> {
  try {
    return await loadWith(api, session, memory);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      forgetIfStill(memory, session);
      return failure(SESSION_UNKNOWN);
    }
    return failure(messageOf(error, LOAD_FAILED));
  }
}

/**
 * Opens a session with the launch code and loads the workflow of the session.
 * With no code, it loads with the session that `memory` kept, as after a
 * reload. The token never leaves this module except through `remember`.
 */
export async function loadWorkflow(
  api: WorkflowApi,
  launchCode: string | undefined,
  memory: SessionMemory,
): Promise<LoadResult> {
  if (launchCode !== undefined) return openWithCode(api, launchCode, memory);
  const kept = memory.recall();
  return kept === undefined
    ? failure(NO_LAUNCH_CODE)
    : resume(api, kept, memory);
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
    ? { ...result, workflow: { ...result.workflow, document } }
    : result;
}
