// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  IDLE,
  reduce,
  startAndFollow,
  type ExecutionState,
  type RunPort,
  type Scheduler,
} from './core';

/** The state of the Execution tab and the one way to change it. */
export interface ExecutionController {
  state: ExecutionState;
  /** Starts a run with the goal; does nothing while a run is in flight. */
  start(goal: string): void;
}

/**
 * Drives one run at a time through `runs`, waiting with `scheduler`, and
 * stops following it when the component unmounts. The state lives with the
 * caller, so it survives a switch of tab.
 */
export function useExecution(
  runs: RunPort | undefined,
  scheduler: Scheduler,
): ExecutionController {
  const [state, dispatch] = useReducer(reduce, IDLE);
  const active = useRef<AbortController>(undefined);

  useEffect(() => () => active.current?.abort(), []);

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
        emit: dispatch,
        signal: controller.signal,
      }).finally(() => {
        if (active.current === controller) active.current = undefined;
      });
    },
    [runs, scheduler],
  );

  return { state, start };
}
