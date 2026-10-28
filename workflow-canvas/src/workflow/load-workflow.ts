// SPDX-License-Identifier: Apache-2.0
import { ApiError, canRetryStatus, type WorkflowApi } from '../api/api';
import type { WorkflowDocument } from '../api/types';
import {
  RunAlreadyActive,
  RunReadRefused,
  RunStartUnsure,
  type RunPort,
} from '../execution/core';
import type { SessionMemory, SessionRecord } from '../launch/session-memory';

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

/**
 * The result of a load. It never rejects, so a caller cannot miss a failure.
 * `remember` keeps the session for a reload; the page calls it once it shows
 * the workflow, so a load that is not shown does not replace the kept session.
 * `refused` tells why the code in the address was not opened, when the kept
 * session was opened in its place.
 */
export type LoadResult =
  | {
      ok: true;
      workflow: LoadedWorkflow;
      remember: () => void;
      refused?: string;
    }
  | { ok: false; message: string };

const NO_LAUNCH_CODE =
  'There is no launch code in the address. Get a fresh launch address from the server; it ends in #<launch code>. An address works once.';

const SESSION_UNKNOWN =
  'The server no longer knows this session. It may have been started again. Get a fresh launch address from the server. An address works once.';

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

// No answer, or an accepted run in a reply the page cannot read: the run may
// have started.
function startUnsureOf(error: unknown): RunStartUnsure | undefined {
  return error instanceof ApiError &&
    (error.status === 0 || error.status === 202)
    ? new RunStartUnsure(error.message)
    : undefined;
}

function failure(message: string): LoadResult {
  return { ok: false, message };
}

// Forgets the token only if no newer session was kept while this one loaded.
function forgetIfStill(memory: SessionMemory, session: SessionRecord): void {
  if (memory.recall()?.token === session.token) memory.forget();
}

// A 401 on a call that carries the token means the server no longer knows the
// session: the token is dropped and the call fails with one message.
function guardSession(
  memory: SessionMemory,
  session: SessionRecord,
): <T>(call: Promise<T>) => Promise<T> {
  return async (call) => {
    try {
      return await call;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      forgetIfStill(memory, session);
      throw new ApiError(SESSION_UNKNOWN, 401);
    }
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

async function loadWith(
  api: WorkflowApi,
  session: SessionRecord,
  memory: SessionMemory,
): Promise<LoadResult> {
  const guard = guardSession(memory, session);
  const document = await guard(api.getWorkflow(session.token));
  return {
    ok: true,
    workflow: {
      harness: session.harness,
      document,
      runs: runPortFor(api, session.token),
    },
    remember: () => memory.remember(session),
  };
}

function isKept(
  memory: SessionMemory,
  expected: SessionRecord | undefined,
): boolean {
  return memory.recall()?.token === expected?.token;
}

// A new session is kept as soon as it exists: a load that fails then (a
// timeout, a 5xx) does not lose the code that was just spent. It replaces
// only `replaces`, the session that was kept when the load began (none, for
// a pasted code, as the page still shows the kept one), so it never
// overwrites a session that was kept meanwhile.
async function openWithCode(
  api: WorkflowApi,
  launchCode: string,
  memory: SessionMemory,
  replaces: SessionRecord | undefined,
): Promise<LoadResult> {
  try {
    const { token, harness, apiVersion } = await api.createSession(launchCode);
    if (apiVersion !== SUPPORTED_API_VERSION) return failure(UNSUPPORTED_API);
    const session = { token, harness };
    if (isKept(memory, replaces)) memory.remember(session);
    return await loadWith(api, session, memory);
  } catch (error) {
    return failure(messageOf(error));
  }
}

async function resume(
  api: WorkflowApi,
  session: SessionRecord,
  memory: SessionMemory,
): Promise<LoadResult> {
  try {
    return await loadWith(api, session, memory);
  } catch (error) {
    return failure(messageOf(error));
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
  if (launchCode !== undefined) {
    return openWithCode(api, launchCode, memory, undefined);
  }
  const kept = memory.recall();
  return kept === undefined
    ? failure(NO_LAUNCH_CODE)
    : resume(api, kept, memory);
}

/**
 * The load when the page opens. It is `loadWorkflow`, except that the session
 * of the code replaces the kept one at once, as no workflow is on the page
 * yet, and a code that fails (as a spent one does) falls back to the session kept
 * before it. The error of the code is shown only if that fails too.
 */
export async function loadOnOpen(
  api: WorkflowApi,
  launchCode: string | undefined,
  memory: SessionMemory,
): Promise<LoadResult> {
  if (launchCode === undefined) return loadWorkflow(api, undefined, memory);
  const kept = memory.recall();
  const result = await openWithCode(api, launchCode, memory, kept);
  if (result.ok || kept === undefined) return result;
  const resumed = await resume(api, kept, memory);
  return resumed.ok ? { ...resumed, refused: result.message } : result;
}

/** The name of the workflow that a load drew, or `undefined` if none is open. */
export function openWorkflowName(
  result: LoadResult | undefined,
): string | undefined {
  return result?.ok ? result.workflow.document.view?.name : undefined;
}
