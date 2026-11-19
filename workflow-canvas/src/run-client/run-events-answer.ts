// SPDX-License-Identifier: Apache-2.0
import type { RunEvent } from '../execution/core/run-follow';

/** The answer of `GET /api/runs/{id}/events`, as `api/openapi.yaml` gives it. */
export interface RunEventsAnswer {
  readonly events: readonly RunEvent[];
  /** The `seq` to send as `after` next time. */
  readonly next: number;
  /** True once the run is `passed` or `halted`. */
  readonly finished: boolean;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'stage_state',
  'console',
  'run_finished',
]);
const STAGE_STATUSES: ReadonlySet<unknown> = new Set([
  'running',
  'passed',
  'blocked',
]);
const RUN_STATUSES: ReadonlySet<unknown> = new Set(['passed', 'halted']);

type Fields = Readonly<Record<string, unknown>>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWholeAtLeast(value: unknown, least: number): value is number {
  return Number.isInteger(value) && (value as number) >= least;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function stageStateOf(seq: number, fields: Fields): RunEvent | undefined {
  const { stage, status, reason } = fields;
  if (!isText(stage) || !STAGE_STATUSES.has(status)) return undefined;
  if (status === 'blocked' && !isText(reason)) return undefined;
  if (status !== 'blocked' && reason !== undefined) return undefined;
  return {
    seq,
    type: 'stage_state',
    stage,
    status: status as 'running' | 'passed' | 'blocked',
    ...(isText(reason) ? { reason } : {}),
  };
}

function consoleOf(seq: number, fields: Fields): RunEvent | undefined {
  const { stage, n, text } = fields;
  if (!isText(stage) || !isWholeAtLeast(n, 1) || !isText(text)) {
    return undefined;
  }
  return { seq, type: 'console', stage, n, text };
}

function runFinishedOf(seq: number, fields: Fields): RunEvent | undefined {
  const { at, status, exit_code } = fields;
  if (!isText(at) || !RUN_STATUSES.has(status)) return undefined;
  if (!isWholeAtLeast(exit_code, 0)) return undefined;
  return {
    seq,
    type: 'run_finished',
    at,
    status: status as 'passed' | 'halted',
    exit_code: exit_code as number,
  };
}

// An event of a type this page does not know keeps only `seq` and `type`, as
// the contract's `LaterEvent` checks nothing else.
function eventOf(value: unknown): RunEvent | undefined {
  if (!isFields(value)) return undefined;
  const { seq, type } = value;
  if (!isWholeAtLeast(seq, 1) || !isText(type) || type === '') return undefined;
  if (!KNOWN_TYPES.has(type)) return { seq, type };
  if (type === 'stage_state') return stageStateOf(seq, value);
  if (type === 'console') return consoleOf(seq, value);
  return runFinishedOf(seq, value);
}

/**
 * Reads a body as an events answer, or `undefined` when it is not one: a
 * field is missing or of the wrong kind, an event of a known type is
 * malformed, the `seq` of the events does not go up, or `next` is below the
 * last of them.
 */
export function parseRunEventsAnswer(
  body: unknown,
): RunEventsAnswer | undefined {
  if (!isFields(body) || !Array.isArray(body.events)) return undefined;
  const { next, finished } = body;
  if (!isWholeAtLeast(next, 0) || typeof finished !== 'boolean') {
    return undefined;
  }
  const events: RunEvent[] = [];
  for (const value of body.events) {
    const event = eventOf(value);
    const last = events.at(-1)?.seq ?? 0;
    if (event === undefined || event.seq <= last) return undefined;
    events.push(event);
  }
  if (next < (events.at(-1)?.seq ?? 0)) return undefined;
  return { events, next, finished };
}
