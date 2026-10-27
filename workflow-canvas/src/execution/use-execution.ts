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

/** The state of the Execution tab and the one way to change it. */
export interface Execution {
  state: ExecutionState;
  /** Starts a run with the goal; does nothing while a run is in flight. */
  start(goal: string): void;
}

/**
 * Drives one run at a time through `runs`, waiting with `scheduler`, and
 * stops following it when the component unmounts. The state lives with the
 * caller, so it survives a switch of tab. `memory` keeps the id of the latest
 * run, so that a page which is opened again joins a run that is still going.
 */
export function useExecution(
  runs: RunPort | undefined,
  scheduler: Scheduler,
  memory: RunMemory = NO_RUN_MEMORY,
): Execution {
  const [state, dispatch] = useReducer(reduce, IDLE);
  const active = useRef<AbortController>(undefined);

  const emit = useCallback(
    (event: ExecutionEvent) => {
      if (event.type === 'started') memory.remember(event.runId);
      dispatch(event);
    },
    [memory],
  );

  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    const runId = runs ? memory.recall() : undefined;
    if (!runs || runId === undefined || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const release = () => {
      if (active.current === controller) active.current = undefined;
    };
    void resumeRun({
      runs,
      scheduler,
      runId,
      emit,
      signal: controller.signal,
    }).finally(release);
    return () => {
      controller.abort();
      release();
    };
  }, [runs, scheduler, memory, emit]);

  const start = useCallback(
    (goal: string) => {
      if (!runs || active.current) return;
      const controller = new AbortController();
      active.current = controller;
      dispatch({ type: 'start' });
      void startAndFollow({
        runs,
        scheduler,
        goal,
        emit,
        signal: controller.signal,
      }).finally(() => {
        if (active.current === controller) active.current = undefined;
      });
    },
    [runs, scheduler, emit],
  );

  return { state, start };
}
