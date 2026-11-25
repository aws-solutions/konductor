// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import { messageOf } from '../api/message-of';
import {
  RunAlreadyActive,
  RunNeedsTrust,
  RunStartUnsure,
  type RunMemory,
} from '../execution/core';
import type { RunParams, StartRun } from './run-params';
import type { RunStart } from './run-start';

const START_FAILED = 'The run did not start.';

const IDLE: RunStart = { kind: 'idle' };

// What the person reads for a start that failed: the sentence of the error,
// with the next step for a server that may have stopped.
function startMessageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? messageOf(error, START_FAILED)
    : START_FAILED;
}

// The server already had a run, so the view follows that one; its goal is
// not the text of the box. A refusal for trust carries the `fix` and the
// goal that was sent, so the same run can be asked for again, and counts the
// refusals in a row so a second one opens the dialog afresh.
function stateOf(
  error: unknown,
  params: RunParams,
  before: RunStart | undefined,
): RunStart {
  if (error instanceof RunAlreadyActive) {
    return { kind: 'going', runId: error.runId, joined: true };
  }
  if (error instanceof RunStartUnsure) {
    return { kind: 'unsure', message: error.message };
  }
  if (error instanceof RunNeedsTrust) {
    return {
      kind: 'trust',
      message: startMessageOf(error),
      fix: error.fix,
      goal: params.goal ?? '',
      params,
      refusal: (before?.kind === 'trust' ? before.refusal : 0) + 1,
    };
  }
  return { kind: 'failed', message: startMessageOf(error) };
}

// The run that `memory` kept, as the page has it after a reload. Its goal is
// not known here, so it counts as a run that was already going.
function recalled(memory: RunMemory | undefined): RunStart {
  const kept = memory?.recall();
  return kept === undefined
    ? IDLE
    : { kind: 'going', runId: kept, joined: true };
}

/**
 * Where the starts come from: one session's start call and its run memory. A
 * new one of either is another session, and so another workflow.
 */
interface StartSource {
  readonly start: StartRun;
  readonly memory: RunMemory | undefined;
}

function sameSource(a: StartSource, b: StartSource): boolean {
  return a.start === b.start && a.memory === b.memory;
}

// A state and the source it was read for, so a state of the session before
// this one is never shown.
interface Started {
  readonly source: StartSource;
  readonly start: RunStart;
}

/** The state of starting a run, and the ways to change it. */
export interface RunStartControls {
  readonly start: RunStart;
  /**
   * Starts a run with the params, the goal among them; does nothing while
   * another start is in flight.
   */
  begin(params: RunParams): void;
  /**
   * Drops the kept run id, without changing what the view shows, for a run
   * that has ended or is gone: a reload must not take it up again.
   */
  forget(): void;
  /**
   * Records that the dialog of this trust refusal was closed, so it stays
   * closed while the refusal is the one on show. A refusal that comes again
   * has a number of its own and opens the dialog.
   */
  closeTrust(refusal: number): void;
}

/**
 * Holds the state of starting runs through `port.start`. A start in flight
 * is never joined by a second one, and unmounting aborts the call, after
 * which no state is set. A run id that `memory` kept is taken up in the
 * first render, as the page does after a reload, and then held here: the
 * view goes on showing that run even once the id has been forgotten, so
 * `forget` drops what a reload would take up and nothing else.
 *
 * A new `port.start` or `memory` is another workflow: the start in flight is
 * aborted, the run id the session before it kept is dropped, because it
 * belongs to the workflow that was left, and the state starts again from what
 * the new memory holds. No run of the session before it is shown under the
 * new one. As the other hooks of the page do, it reads those two by identity,
 * so a caller keeps them for as long as the session lives.
 */
export function useRunStart({
  port,
  memory,
}: {
  readonly port: { readonly start: StartRun };
  /** Keeps the run across a reload of the page. */
  readonly memory?: RunMemory;
}): RunStartControls {
  const source: StartSource = { start: port.start, memory };
  const [started, setStarted] = useState<Started>();
  // The run the memory of this source kept, read once when the source is
  // taken up and held from then on, so forgetting the id does not take the
  // run off the view.
  const [takenUp, setTakenUp] = useState<Started>(() => ({
    source,
    start: recalled(memory),
  }));
  const inFlight = useRef<AbortController>(undefined);
  const latest = useRef(source);
  const applied = useRef(source);
  const shown = useRef<RunStart>(IDLE);

  useEffect(() => {
    latest.current = { start: port.start, memory };
  });

  // The abort and the forget of the session before this one, and the reading
  // of the new one. A render between the two sources shows no run at all.
  useEffect(() => {
    const previous = applied.current;
    if (sameSource(previous, { start: port.start, memory })) return;
    const next = { start: port.start, memory };
    applied.current = next;
    inFlight.current?.abort();
    inFlight.current = undefined;
    previous.memory?.forget();
    setStarted(undefined);
    setTakenUp({ source: next, start: recalled(memory) });
  }, [port.start, memory]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const begin = useCallback((params: RunParams) => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const now = latest.current;
    const set = (start: RunStart) => setStarted({ source: now, start });
    // Read before the state is replaced, so a refusal knows whether the one
    // before it was a refusal too.
    const before = shown.current;
    set({ kind: 'starting' });
    void now
      .start(params, controller.signal)
      .then((runId) => {
        if (controller.signal.aborted) return;
        now.memory?.remember(runId);
        set({ kind: 'going', runId, joined: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const state = stateOf(error, params, before);
        if (state.kind === 'going') now.memory?.remember(state.runId);
        set(state);
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = undefined;
      });
  }, []);

  const forget = useCallback(() => latest.current.memory?.forget(), []);

  const closeTrust = useCallback((refusal: number) => {
    setStarted((current) => {
      if (!current) return current;
      const { start } = current;
      if (start.kind !== 'trust' || start.refusal !== refusal) return current;
      return { source: current.source, start: { ...start, closed: true } };
    });
  }, []);

  const held =
    started && sameSource(started.source, source) ? started.start : undefined;
  const kept = sameSource(takenUp.source, source) ? takenUp.start : IDLE;
  const start = held ?? kept;
  // What the view shows now, for the next refusal to count from.
  shown.current = start;
  return { start, begin, forget, closeTrust };
}
