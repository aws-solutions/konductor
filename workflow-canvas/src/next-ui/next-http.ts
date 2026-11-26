// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../api/api';
import { bodyOf, withTimeout } from '../api/http-api';
import {
  BAD_REPLY,
  errorCodeOf,
  errorFixOf,
  errorMessageOf,
  errorRunIdOf,
  isObject,
  parseRunStarted,
  parseWorkflowDocument,
} from '../api/parse';
import type { LibraryEntry, WorkflowDocument } from '../api/types';
import {
  parseWorkflowExtras,
  type WorkflowExtras,
} from '../api/workflow-extras';
import type { AgentOption } from '../designer-view/field-rules';
import type { CheckAnswer, ValidateRequest } from '../designer-view/yaml-draft';
import {
  RunAlreadyActive,
  RunNeedsTrust,
  RunStartUnsure,
} from '../execution/core/ports';
import type { RunSummaryRow } from '../execution/core/run-history';
import type { ReadEvents } from '../run-client/follow-run-events';
import { runEventsPath } from '../run-client/follow-run-events';
import type { CheckStates, ReadChecks } from '../execution/core/run-checks';
import type { StartRun } from '../run-view/run-params';
import type { ListRuns } from '../run-view/use-run-history';

/*
 * The calls that the views need and the page's API client does
 * not have yet: the extra fields of the workflow, the agents, the past runs,
 * the events of a run, the start of a run with its params, the state of the
 * run's checks and a check of a text that keeps the lines of each stage. They talk to the relative `/api`,
 * as the client does, so the page and the server share one origin, and they
 * carry the transport and the error reading of `api/http-api.ts` and
 * `api/parse.ts`, so an error of these calls says what to do about it in the
 * same words.
 */

type Fetch = typeof fetch;

const UNREACHABLE =
  'The server did not answer. Check that it is still running.';

const NO_SESSION =
  'The page has no session with the server. Reload it with a fresh launch address.';

const SESSION_UNKNOWN =
  'The server no longer knows this session. It may have been started again. Start `flow view` again and open the address it prints. An address works once.';

/** Internal code for a copy whose committed root cannot be confirmed. */
export const COPY_UNCERTAIN_CODE = 'copy_uncertain';
const COPY_UNCERTAIN =
  "The copy may have been created, but the server's current workflow could not be confirmed. Reload the page before editing or running anything.";

/** The status that says the server no longer knows the session. */
const SESSION_LOST_STATUS = 401;

const RUN_ACCEPTED_UNREADABLE =
  'The server accepted the run, but its reply could not be read. The run may have started.';

// The server names the run it already has in its 409, so the view can follow
// that one instead of starting another.
function activeRunOf(error: unknown): RunAlreadyActive | undefined {
  return error instanceof ApiError &&
    error.code === 'already_running' &&
    error.runId !== undefined
    ? new RunAlreadyActive(error.message, error.runId)
    : undefined;
}

function trustNeededOf(error: unknown): RunNeedsTrust | undefined {
  return error instanceof ApiError &&
    error.code === 'trust_required' &&
    error.fix !== undefined
    ? new RunNeedsTrust(error.message, error.fix)
    : undefined;
}

// No answer at all: the server may have taken the run, so the view offers a
// reload rather than a second start.
function startUnsureOf(error: unknown): RunStartUnsure | undefined {
  return error instanceof ApiError && error.status === 0
    ? new RunStartUnsure(error.message)
    : undefined;
}

/** How long one of these calls may take before the page gives up on it. */
export const NEXT_REQUEST_TIMEOUT_MS = 15_000;

/** The calls that the Design, Run and Library views make beyond the session's own. */
export interface NextPorts {
  /** Reads the `kind`, `range`, `stage_fields` and default goal of the workflow. */
  readonly loadExtras: (signal?: AbortSignal) => Promise<WorkflowExtras>;
  /** The agents a stage may name, as `GET /api/agents` lists them. */
  readonly listAgents: (
    signal?: AbortSignal,
  ) => Promise<readonly AgentOption[]>;
  /** Lists the shipped workflows. */
  readonly listLibrary: (signal?: AbortSignal) => Promise<LibraryEntry[]>;
  /** Opens one ready shipped workflow read-only. */
  readonly getLibrary: (
    name: string,
    signal?: AbortSignal,
  ) => Promise<WorkflowDocument>;
  /** Copies a ready shipped workflow under a new name. */
  readonly copyLibrary: (
    name: string,
    as: string,
    signal?: AbortSignal,
  ) => Promise<WorkflowDocument>;
  readonly listRuns: ListRuns;
  readonly readEvents: ReadEvents;
  /**
   * Starts a run with the goal and the params, as `POST /api/run` does, and
   * resolves to its id. It rejects with `RunAlreadyActive` when the server
   * already has a run, and with `RunStartUnsure` when the outcome of the
   * start is not known.
   */
  readonly startRun: StartRun;
  /**
   * The state of each check of a run, by check id, as
   * `GET /api/runs/{id}` reports it. Only the checks are read from there:
   * the stages of the run come from its events, so there is one source for
   * each thing the view draws.
   */
  readonly readChecks: ReadChecks;
  /** Checks a text and keeps the lines of each stage of its view. */
  readonly validate: (
    request: ValidateRequest,
    signal: AbortSignal,
  ) => Promise<CheckAnswer>;
}

function agentOf(value: unknown): AgentOption {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const { id, summary } = value;
  if (typeof id !== 'string' || typeof summary !== 'string') {
    throw new ApiError(BAD_REPLY, 200);
  }
  return { id, summary };
}

function agentsOf(body: unknown): readonly AgentOption[] {
  const agents = isObject(body) ? body.agents : undefined;
  if (!Array.isArray(agents)) throw new ApiError(BAD_REPLY, 200);
  return agents.map(agentOf);
}

const LIBRARY_NAME = /^library\/[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_LIBRARY_ENTRIES = 100;
const MAX_LIBRARY_TITLE = 120;
const MAX_LIBRARY_DETAIL = 240;
const characters = (text: string) => [...text].length;

function libraryEntryOf(value: unknown): LibraryEntry {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const name = textOrFail(value.name);
  const title = textOrFail(value.title);
  const summary = textOrFail(value.summary);
  const { status, waits } = value;
  if (
    !LIBRARY_NAME.test(name) ||
    title === '' ||
    characters(title) > MAX_LIBRARY_TITLE ||
    /[\r\n]/.test(title) ||
    summary === '' ||
    characters(summary) > MAX_LIBRARY_DETAIL ||
    /[\r\n]/.test(summary) ||
    (status !== 'ready' && status !== 'planned') ||
    (status === 'ready' && waits !== undefined) ||
    (status === 'planned' &&
      (typeof waits !== 'string' ||
        waits === '' ||
        characters(waits) > MAX_LIBRARY_DETAIL ||
        /[\r\n]/.test(waits)))
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return status === 'ready'
    ? { name, title, summary, status }
    : { name, title, summary, status, waits: waits as string };
}

function libraryOf(body: unknown): LibraryEntry[] {
  const entries = isObject(body) ? body.entries : undefined;
  if (!Array.isArray(entries) || entries.length > MAX_LIBRARY_ENTRIES) {
    throw new ApiError(BAD_REPLY, 200);
  }
  const parsed = entries.map(libraryEntryOf);
  const names = new Set(parsed.map((entry) => entry.name));
  if (names.size !== parsed.length) throw new ApiError(BAD_REPLY, 200);
  return parsed;
}

const LIBRARY_HASH = /^[0-9a-f]{64}$/;

function libraryDocumentOf(
  body: unknown,
  name: string,
  readOnly: boolean,
): WorkflowDocument {
  const document = parseWorkflowDocument(body);
  const viewName = readOnly ? name.slice('library/'.length) : name;
  if (
    document.name !== name ||
    document.readOnly !== readOnly ||
    document.text === null ||
    document.hash === null ||
    !LIBRARY_HASH.test(document.hash) ||
    document.view === null ||
    document.view.name !== viewName
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return document;
}

const RUN_STATUSES: ReadonlySet<unknown> = new Set([
  'running',
  'passed',
  'halted',
]);

function runOf(value: unknown): RunSummaryRow {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const { run_id: runId, started_at: startedAt, status, goal } = value;
  const truncated = value.goal_truncated;
  if (
    typeof runId !== 'string' ||
    typeof startedAt !== 'string' ||
    typeof goal !== 'string' ||
    typeof truncated !== 'boolean' ||
    !RUN_STATUSES.has(status)
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return {
    run_id: runId,
    started_at: startedAt,
    status: status as RunSummaryRow['status'],
    goal,
    goal_truncated: truncated,
  };
}

function runsOf(body: unknown): readonly RunSummaryRow[] {
  const runs = isObject(body) ? body.runs : undefined;
  if (!Array.isArray(runs)) throw new ApiError(BAD_REPLY, 200);
  return runs.map(runOf);
}

const SEVERITIES = ['error', 'warning', 'info'] as const;

type Severity = (typeof SEVERITIES)[number];

function isWholeAtLeast(value: unknown, least: number): value is number {
  return Number.isInteger(value) && (value as number) >= least;
}

function textOrFail(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(BAD_REPLY, 200);
  return value;
}

// A severity a later release adds is taken as an error, so a finding this
// page cannot judge never reads as harmless. Every other field the contract
// requires must be there, `file` included, though no view shows it: a reply
// that leaves one out is one this page does not understand.
function diagnosticOf(value: unknown): CheckAnswer['diagnostics'][number] {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const severity = SEVERITIES.find((known) => known === value.severity);
  const places = ['line', 'column', 'end_line', 'end_column'] as const;
  for (const place of places) {
    if (!isWholeAtLeast(value[place], 1)) throw new ApiError(BAD_REPLY, 200);
  }
  textOrFail(value.file);
  return {
    code: textOrFail(value.code),
    severity: severity ?? ('error' as Severity),
    path: textOrFail(value.path),
    line: value.line as number,
    column: value.column as number,
    end_line: value.end_line as number,
    end_column: value.end_column as number,
    message: textOrFail(value.message),
    ...(typeof value.suggestion === 'string'
      ? { suggestion: value.suggestion }
      : {}),
  };
}

// One stage of the view: the `name`, `kind`, `agent` and `range` that the
// contract requires, with `kind` and `range` being what the Design view
// draws it by. Every other key is kept as it came, because the form shows
// the keys of the file.
function viewStageOf(
  value: unknown,
): CheckAnswer['view'] extends null
  ? never
  : NonNullable<CheckAnswer['view']>['stages'][number] {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const name = textOrFail(value.name);
  textOrFail(value.kind);
  textOrFail(value.agent);
  const range = value.range;
  if (
    !isObject(range) ||
    !isWholeAtLeast(range.line, 1) ||
    !isWholeAtLeast(range.end_line, 1) ||
    (range.end_line as number) < (range.line as number)
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return { ...value, name };
}

// The `checks` of a run: a state per check id. A run of the contract always
// has the map, and it is empty for a workflow that declares no check.
function checkStatesOf(body: unknown): CheckStates {
  const run = isObject(body) ? body.run : undefined;
  const checks = isObject(run) ? run.checks : undefined;
  if (!isObject(checks)) throw new ApiError(BAD_REPLY, 200);
  return Object.fromEntries(
    Object.entries(checks).map(([id, state]) => [id, textOrFail(state)]),
  );
}

/** The most stages a workflow may have, as the contract allows. */
const STAGES_MOST = 40;

/** The longest outcome of an intent, in characters, as the contract allows. */
const OUTCOME_LONGEST = 300;

// The intent of a workflow, whose outcome says what the run is for: one line
// of at most three hundred characters, as the contract gives it. A character
// there is a code point, as it is everywhere the contract counts them, so an
// outcome written in characters outside the first plane is measured as a
// person reads it and not as the two units each takes in a JavaScript string.
// Every other key of the intent, such as the checks of `accept`, is kept as
// it came.
function intentOrFail(value: unknown): unknown {
  if (!isObject(value)) throw new ApiError(BAD_REPLY, 200);
  const outcome = textOrFail(value.outcome);
  if (
    outcome === '' ||
    [...outcome].length > OUTCOME_LONGEST ||
    /[\r\n]/.test(outcome)
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return value;
}

// The parsed workflow of the answer. `parse.ts` has `parseCheckResult` for
// this body, but it drops the `kind` and the `range` of a stage, which the
// Design view draws and marks by, so the fields are read here instead. The
// contract requires the field, and allows it to be null, which is what a
// text with errors answers with; a body that leaves it out altogether is a
// reply this page does not understand.
//
// A workflow has an intent, with the outcome of its run, and one to forty
// stages. Every other key of the answer is kept as it came, the `params` of a
// file and the keys a later release may add among them: the form shows the
// keys of the file, and a key this page does not know is not a reply it
// cannot read.
function checkViewOf(value: unknown): CheckAnswer['view'] {
  if (value === null) return null;
  if (
    !isObject(value) ||
    !Array.isArray(value.stages) ||
    value.stages.length < 1 ||
    value.stages.length > STAGES_MOST
  ) {
    throw new ApiError(BAD_REPLY, 200);
  }
  return {
    ...value,
    format: textOrFail(value.format),
    version: textOrFail(value.version),
    name: textOrFail(value.name),
    intent: intentOrFail(value.intent),
    stages: value.stages.map(viewStageOf),
  };
}

function countOf(
  diagnostics: readonly { severity: string }[],
  of: Severity,
): number {
  return diagnostics.filter((one) => one.severity === of).length;
}

/**
 * The answer of `POST /api/validate`, with every field the views read: the
 * stages of the view with their lines, and the place and sentence of each
 * finding. A field the contract shapes differently is a reply this page does
 * not understand, so the view says so instead of drawing it.
 */
function checkAnswerOf(body: unknown): CheckAnswer {
  if (!isObject(body) || !Array.isArray(body.diagnostics)) {
    throw new ApiError(BAD_REPLY, 200);
  }
  if (!('view' in body)) throw new ApiError(BAD_REPLY, 200);
  const findings = body.diagnostics.map(diagnosticOf);
  return {
    errors: countOf(findings, 'error'),
    warnings: countOf(findings, 'warning'),
    infos: countOf(findings, 'info'),
    view: checkViewOf(body.view),
    diagnostics: findings,
  };
}

/**
 * Builds the calls of the views for one loaded workflow. The
 * token is the one that workflow was loaded with, read once and held here,
 * so a session opened later, or one that is still waiting for its first
 * load, is never addressed by these calls. Each loaded workflow gets its own
 * object, which the hooks of the views use to tell one workflow from another.
 *
 * A 401 is the guard of the session: the server no longer knows it, so
 * `onSessionLost` is told, once, and the call fails with a sentence fit to
 * show. Any other refusal carries the server's own sentence.
 */
export function createNextPorts(
  token: string | undefined,
  {
    fetchFn = fetch,
    timeoutMs = NEXT_REQUEST_TIMEOUT_MS,
    onSessionLost,
  }: {
    readonly fetchFn?: Fetch;
    readonly timeoutMs?: number;
    /** Called the first time a call of this session is answered with 401. */
    readonly onSessionLost?: () => void;
  } = {},
): NextPorts {
  let lost = false;
  const sessionLost = (): never => {
    if (!lost) {
      lost = true;
      onSessionLost?.();
    }
    throw new ApiError(SESSION_UNKNOWN, 401);
  };
  const headers = () => {
    if (token === undefined) throw new ApiError(NO_SESSION, 401);
    return { Authorization: `Bearer ${token}` };
  };
  const send = async (
    path: string,
    init: RequestInit,
    outer: AbortSignal | undefined,
  ): Promise<unknown> => {
    const auth = headers();
    let reply: { response: Response; body: unknown };
    try {
      reply = await withTimeout(timeoutMs, outer, async (signal) => {
        const response = await fetchFn(path, {
          ...init,
          signal,
          headers: { ...init.headers, ...auth },
        });
        return { response, body: await bodyOf(response) };
      });
    } catch {
      throw new ApiError(UNREACHABLE, 0);
    }
    const { response, body } = reply;
    if (response.ok) return body;
    if (response.status === SESSION_LOST_STATUS) sessionLost();
    // The sentence of the body with its `fix`, which says what to do about
    // the error, and the `code`, which tells a proxy's 401 from the server's.
    // The `run_id` comes with it, because a 409 on a start names the run the
    // server already has.
    throw new ApiError(
      errorMessageOf(body) ?? `The server answered ${response.status}.`,
      response.status,
      errorCodeOf(body),
      errorRunIdOf(body),
      [],
      undefined,
      errorFixOf(body),
    );
  };
  return {
    loadExtras: async (signal) =>
      parseWorkflowExtras(await send('/api/workflow', {}, signal)),
    listAgents: async (signal) =>
      agentsOf(await send('/api/agents', {}, signal)),
    listLibrary: async (signal) =>
      libraryOf(await send('/api/library', {}, signal)),
    getLibrary: async (name, signal) =>
      libraryDocumentOf(
        await send(`/api/library/${encodeURIComponent(name)}`, {}, signal),
        name,
        true,
      ),
    copyLibrary: async (name, as, signal) => {
      try {
        const body = await send(
          `/api/library/${encodeURIComponent(name)}/copy`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ as }),
          },
          signal,
        );
        return libraryDocumentOf(body, as, false);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          (error.status !== 200 && error.status !== 0)
        ) {
          throw error;
        }
        try {
          return libraryDocumentOf(
            await send('/api/workflow', {}, signal),
            as,
            false,
          );
        } catch {
          throw new ApiError(COPY_UNCERTAIN, 200, COPY_UNCERTAIN_CODE);
        }
      }
    },
    listRuns: async (signal) => runsOf(await send('/api/runs', {}, signal)),
    startRun: async (params, signal) => {
      try {
        const body = await send(
          '/api/run',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ params }),
          },
          signal,
        );
        // The server took the run, so a reply this page cannot read does not
        // mean the run did not start.
        try {
          return parseRunStarted(body);
        } catch {
          throw new RunStartUnsure(RUN_ACCEPTED_UNREADABLE);
        }
      } catch (error) {
        throw (
          activeRunOf(error) ??
          trustNeededOf(error) ??
          startUnsureOf(error) ??
          error
        );
      }
    },
    // The long poll holds the call open, so the follower's own limit times it
    // and this one does not: it reads the reply as the follower expects.
    readEvents: async (runId, after, wait, signal) => {
      const auth = headers();
      const response = await fetchFn(runEventsPath(runId, after, wait), {
        headers: auth,
        signal,
      });
      if (response.status === SESSION_LOST_STATUS && !lost) {
        lost = true;
        onSessionLost?.();
      }
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
      };
    },
    readChecks: async (runId, signal) =>
      checkStatesOf(
        await send(`/api/runs/${encodeURIComponent(runId)}`, {}, signal),
      ),
    validate: async (request, signal) =>
      checkAnswerOf(
        await send(
          '/api/validate',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
          },
          signal,
        ),
      ),
  };
}
