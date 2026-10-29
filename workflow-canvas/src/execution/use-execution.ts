// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  IDLE,
  reduce,
  startAndFollow,
  type ExecutionEvent,
  type ExecutionState,
  type RunPort,
  type Scheduler,
} from './core';

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
 * caller, so it survives a switch of tab. When `runs` is replaced by those of
 * another workflow, the run in hand is let go: it stays on its server, but
 * this page no longer follows it or shows its status.
 */
export function useExecution(
  runs: RunPort | undefined,
  scheduler: Scheduler,
): ExecutionController {
  const [state, dispatch] = useReducer(reduceAction, IDLE);
  const active = useRef<AbortController>(undefined);
  const opened = useRef(runs);

  useEffect(() => () => active.current?.abort(), []);

  useEffect(() => {
    const left = opened.current;
    opened.current = runs;
    if (left === undefined || runs === undefined || left === runs) return;
    active.current?.abort();
    active.current = undefined;
    dispatch({ type: 'reset' });
  }, [runs]);

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
