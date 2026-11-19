// SPDX-License-Identifier: Apache-2.0
import { timestampMs } from './timestamp';

/*
 * The event shapes of `GET /api/runs/{id}/events` in `api/openapi.yaml`,
 * narrowed to the fields this reducer reads. They are local until the API
 * client parses run events.
 */

/** A stage moved to `running`, `passed` or `blocked`. */
export interface StageStateEvent {
  readonly seq: number;
  readonly type: 'stage_state';
  readonly stage: string;
  readonly status: 'running' | 'passed' | 'blocked';
  /** Set when `status` is `blocked`. */
  readonly reason?: string;
}

/** One line of the standard output of a stage, live only. */
export interface ConsoleEvent {
  readonly seq: number;
  readonly type: 'console';
  readonly stage: string;
  /** The number of the line in the stage's output, from 1. */
  readonly n: number;
  readonly text: string;
}

/** The run ended. No event comes after it. */
export interface RunFinishedEvent {
  readonly seq: number;
  readonly type: 'run_finished';
  /** When the run ended, as `2026-10-24T04:12:05Z`. */
  readonly at: string;
  readonly status: 'passed' | 'halted';
  readonly exit_code: number;
}

/** An event of a type a later version of the API adds. It is skipped. */
export interface LaterEvent {
  readonly seq: number;
  readonly type: string;
}

/** One event of a run, as the API sends it. */
export type RunEvent =
  StageStateEvent | ConsoleEvent | RunFinishedEvent | LaterEvent;

/**
 * The most console lines kept for the whole run, as the server holds at most
 * the last 1000 lines of a run. Past it the oldest line goes, whatever its
 * stage.
 */
export const CONSOLE_LINES_PER_RUN = 1000;

/** One console line of a stage. */
export interface ConsoleLine {
  readonly n: number;
  readonly text: string;
}

/** Where one stage is, and the last of its console lines, oldest first. */
export interface FollowedStage {
  readonly name: string;
  readonly status: 'pending' | 'running' | 'passed' | 'blocked';
  readonly reason?: string;
  readonly console: readonly ConsoleLine[];
  /**
   * True once an earlier line of the stage is known not to be held: the
   * run-wide cap dropped it, or a line arrived after a gap in `n`.
   */
  readonly dropped: boolean;
}

/** How the run ended. */
export interface RunOutcome {
  readonly status: 'passed' | 'halted';
  readonly exitCode: number;
}

/** What the events read so far say about a run. */
export interface FollowedRun {
  /** The stages in run order. */
  readonly stages: readonly FollowedStage[];
  /** Set once the `run_finished` event is read. */
  readonly outcome?: RunOutcome;
  /**
   * When the run ended, in milliseconds since the epoch: the `at` of its
   * `run_finished`. Set with `outcome`, unless that `at` could not be read.
   */
  readonly finishedAt?: number;
  /** The `seq` to send as `after` next time. */
  readonly next: number;
  /** The stage of each held console line, oldest first, for the cap. */
  readonly consoleOrder: readonly string[];
}

/** A run of `order` that no event has been read for: every stage pending. */
export function startFollowing(order: readonly string[]): FollowedRun {
  return {
    stages: order.map((name) => ({
      name,
      status: 'pending',
      console: [],
      dropped: false,
    })),
    next: 0,
    consoleOrder: [],
  };
}

function isStageState(event: RunEvent): event is StageStateEvent {
  return event.type === 'stage_state';
}

function isConsole(event: RunEvent): event is ConsoleEvent {
  return event.type === 'console';
}

function isRunFinished(event: RunEvent): event is RunFinishedEvent {
  return event.type === 'run_finished';
}

function withStage(
  run: FollowedRun,
  name: string,
  change: (stage: FollowedStage) => FollowedStage,
): FollowedRun {
  return {
    ...run,
    stages: run.stages.map((stage) =>
      stage.name === name ? change(stage) : stage,
    ),
  };
}

function withLine(stage: FollowedStage, line: ConsoleLine): FollowedStage {
  const expected = (stage.console.at(-1)?.n ?? 0) + 1;
  return {
    ...stage,
    console: [...stage.console, line],
    dropped: stage.dropped || line.n !== expected,
  };
}

function withoutOldestLine(stage: FollowedStage): FollowedStage {
  return { ...stage, console: stage.console.slice(1), dropped: true };
}

function addLine(run: FollowedRun, event: ConsoleEvent): FollowedRun {
  if (!run.stages.some((stage) => stage.name === event.stage)) return run;
  const added = withStage(
    { ...run, consoleOrder: [...run.consoleOrder, event.stage] },
    event.stage,
    (stage) => withLine(stage, { n: event.n, text: event.text }),
  );
  if (added.consoleOrder.length <= CONSOLE_LINES_PER_RUN) return added;
  const [oldest, ...rest] = added.consoleOrder;
  return withStage(
    { ...added, consoleOrder: rest },
    oldest!,
    withoutOldestLine,
  );
}

function applyOne(run: FollowedRun, event: RunEvent): FollowedRun {
  if (isStageState(event)) {
    return withStage(run, event.stage, (stage) => ({
      name: stage.name,
      status: event.status,
      console: stage.console,
      dropped: stage.dropped,
      ...(event.reason === undefined ? {} : { reason: event.reason }),
    }));
  }
  if (isConsole(event)) return addLine(run, event);
  if (isRunFinished(event)) {
    const finishedAt = timestampMs(event.at);
    return {
      ...run,
      outcome: { status: event.status, exitCode: event.exit_code },
      ...(finishedAt === undefined ? {} : { finishedAt }),
    };
  }
  return run;
}

/**
 * Applies `events`, in `seq` order, to what is known of the run. An event
 * whose `seq` is not above `next` was read before and is dropped, so a call
 * that resumes from an earlier `after` changes nothing twice. A `seq` may be
 * skipped when a finished run is read after the server's 60-second grace for
 * console lines, or after the server restarts. An event of an unknown type,
 * for a stage the run does not have, or after the end of the run moves `next`
 * and changes nothing else.
 */
export function applyRunEvents(
  run: FollowedRun,
  events: readonly RunEvent[],
): FollowedRun {
  let state = run;
  for (const event of events) {
    if (event.seq <= state.next) continue;
    const applied = state.outcome ? state : applyOne(state, event);
    state = { ...applied, next: event.seq };
  }
  return state;
}
