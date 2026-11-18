// SPDX-License-Identifier: Apache-2.0

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
 * The most console lines kept for one stage. The server holds at most the
 * last 1000 lines of a run, so a stage never needs more to match it.
 */
export const CONSOLE_LINES_PER_STAGE = 1000;

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
  /** The `seq` to send as `after` next time. */
  readonly next: number;
}

/** A run of `order` that no event has been read for: every stage pending. */
export function startFollowing(order: readonly string[]): FollowedRun {
  return {
    stages: order.map((name) => ({ name, status: 'pending', console: [] })),
    next: 0,
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
  const lines = [...stage.console, line];
  return { ...stage, console: lines.slice(-CONSOLE_LINES_PER_STAGE) };
}

function applyOne(run: FollowedRun, event: RunEvent): FollowedRun {
  if (isStageState(event)) {
    return withStage(run, event.stage, (stage) => ({
      name: stage.name,
      status: event.status,
      console: stage.console,
      ...(event.reason === undefined ? {} : { reason: event.reason }),
    }));
  }
  if (isConsole(event)) {
    return withStage(run, event.stage, (stage) =>
      withLine(stage, { n: event.n, text: event.text }),
    );
  }
  if (isRunFinished(event)) {
    return {
      ...run,
      outcome: { status: event.status, exitCode: event.exit_code },
    };
  }
  return run;
}

/**
 * Applies `events`, in `seq` order, to what is known of the run. An event
 * whose `seq` is not above `next` was read before and is dropped, so a call
 * that resumes from an earlier `after` changes nothing twice. A `seq` may be
 * skipped, as the server keeps no console lines once a run ends. An event of
 * an unknown type, for a stage the run does not have, or after the end of the
 * run moves `next` and changes nothing else.
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
