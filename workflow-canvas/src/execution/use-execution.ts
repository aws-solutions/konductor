// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  IDLE,
  NO_RUN_MEMORY,
  reduce,
  resumeRun,
  startAndFollow,
  type ExecutionEvent,
  type ExecutionState,
  type RunMemory,
  type RunPort,
  type Scheduler,
} from './core';

// A loop that follows a run. `resuming` holds until it has found a run to join.
interface Loop {
  controller: AbortController;
  resuming: boolean;
}

// `reset` is the hook's own event: another workflow was opened, so the run of
// the one that was left is no longer the run of this page.
type Action = ExecutionEvent | { type: 'reset' };

function reduceAction(state: ExecutionState, action: Action): ExecutionState {
  return action.type === 'reset' ? IDLE : reduce(state, action);
}

/** The state of the Execution tab and the one way to change it. */
export interface ExecutionController {
  state: ExecutionState;
  /** Starts a run with the goal; does nothing while a run is in flight. */
  start(goal: string): void;
}

/**
 * Drives one run at a time through `runs`, waiting with `scheduler`, and
 * stops following it when the component unmounts. The state lives with the
 * caller, so it survives a switch of tab. `memory` keeps the id of the latest
 * run, so that a page which is opened again joins a run that is still going.
 * When `runs` is replaced by those of another workflow, the run in hand is let
 * go: it stays on its server, but this page no longer follows it or shows its
 * status.
 */
export function useExecution(
  runs: RunPort | undefined,
  scheduler: Scheduler,
  memory: RunMemory = NO_RUN_MEMORY,
): ExecutionController {
  const [state, dispatch] = useReducer(reduceAction, IDLE);
  const active = useRef<Loop>(undefined);
  const opened = useRef(runs);

  const emit = useCallback(
    (event: ExecutionEvent) => {
      if (event.type === 'started') memory.remember(event.runId);
      if (event.type === 'start' && active.current) {
        active.current.resuming = false;
      }
      dispatch(event);
    },
    [memory],
  );

  // Claims the one place for a loop, runs it, and gives the place back when it
  // ends. Returns the loop, whose controller stops it.
  const track = useCallback(
    (resuming: boolean, run: (signal: AbortSignal) => Promise<void>): Loop => {
      const loop: Loop = { controller: new AbortController(), resuming };
      active.current = loop;
      void run(loop.controller.signal).finally(() => {
        if (active.current === loop) active.current = undefined;
      });
      return loop;
    },
    [],
  );

  useEffect(() => () => active.current?.controller.abort(), []);

  useEffect(() => {
    const left = opened.current;
    opened.current = runs;
    if (left === undefined || runs === undefined || left === runs) return;
    active.current?.controller.abort();
    active.current = undefined;
    dispatch({ type: 'reset' });
  }, [runs]);

  useEffect(() => {
    const runId = runs ? memory.recall() : undefined;
    if (!runs || runId === undefined || active.current) return;
    const loop = track(true, (signal) =>
      resumeRun({ runs, scheduler, runId, emit, signal }),
    );
    return () => {
      loop.controller.abort();
      if (active.current === loop) active.current = undefined;
    };
  }, [runs, scheduler, memory, emit, track]);

  const start = useCallback(
    (goal: string) => {
      if (!runs) return;
      // A page that is only looking for a run to join gives way to a click on
      // Run: a run that is still going answers 409 and is joined anyway.
      if (active.current?.resuming) active.current.controller.abort();
      else if (active.current) return;
      dispatch({ type: 'start' });
      track(false, (signal) =>
        startAndFollow({ runs, scheduler, goal, emit, signal }),
      );
    },
    [runs, scheduler, emit, track],
  );

  return { state, start };
}
