// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import type { WorkflowExtras } from '../api/workflow-extras';
import type { AgentOption } from '../designer-view/field-rules';
import { KNOWN_AGENTS } from '../designer/core';
import type { NextPorts } from './next-http';

/** The fields and the agents that the newer views draw from. */
export interface NextData {
  readonly extras: WorkflowExtras;
  readonly agents: readonly AgentOption[];
  /**
   * Whether `extras` is what the server said about the workflow the page has
   * now. It is false while that read is in flight and after one that failed,
   * so a view can tell a field the workflow does not declare from one it has
   * not been told about yet. It says nothing about the agents: the Run view
   * needs none of them, so a run is never held up by the list.
   */
  readonly ready: boolean;
  /** Why the fields of the workflow could not be read. */
  readonly failure?: string;
  /** Why the agents could not be listed; the page then offers the ones it knows. */
  readonly agentsFailure?: string;
}

const NO_EXTRAS: WorkflowExtras = { stageFields: {} };

const FIELDS_FAILED = 'The server did not give the fields of this workflow.';

const AGENTS_FAILED =
  'The server did not list the agents, so only the ones this page knows are offered.';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : fallback;
}

/** One read's answer, and which session and `reload` it answers for. */
interface Held<T> {
  readonly ports: NextPorts;
  readonly reload: unknown;
  readonly value: T;
  readonly failure?: string;
}

/** Where one read is: what it gave, whether that is current, and why not. */
interface ReadState<T> {
  readonly value: T;
  readonly ready: boolean;
  readonly failure: string | undefined;
}

// Stable, so each read's effect depends on the session and `reload` alone.
const takeExtras = (ports: NextPorts, signal: AbortSignal) =>
  ports.loadExtras(signal);

const takeAgents = (ports: NextPorts, signal: AbortSignal) =>
  ports.listAgents(signal);

/**
 * Reads one thing of the workflow through `ports`, and again whenever
 * `reload` changes. The read is aborted by the next one and by unmounting,
 * and no state is set after that.
 *
 * What it gave belongs to the session and the `reload` it was read for: until
 * both match, the caller has `fallback` and is not ready, so no view shows
 * what the workflow held before a save or under another session. A read that
 * failed is not ready either, and carries its reason.
 */
function useRead<T>(
  ports: NextPorts | undefined,
  reload: unknown,
  take: (ports: NextPorts, signal: AbortSignal) => Promise<T>,
  fallback: T,
  failed: string,
): ReadState<T> {
  const [held, setHeld] = useState<Held<T>>();

  useEffect(() => {
    if (ports === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    void take(ports, signal)
      .then((value) => {
        if (!signal.aborted) setHeld({ ports, reload, value });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setHeld({
          ports,
          reload,
          value: fallback,
          failure: messageOf(error, failed),
        });
      });
    return () => controller.abort();
  }, [ports, reload, take, fallback, failed]);

  if (ports === undefined || held?.ports !== ports || held.reload !== reload) {
    return { value: fallback, ready: false, failure: undefined };
  }
  return {
    value: held.value,
    ready: held.failure === undefined,
    failure: held.failure,
  };
}

/**
 * Reads the extra fields of the workflow and the list of agents once, and
 * again whenever `reload` changes, such as after a save, because a save can
 * change the keys a stage may have.
 *
 * The two are read side by side and answer for themselves. The Design view
 * needs the agents and the Run view does not, so a list that is still coming
 * or that failed leaves the fields of the workflow ready and a run free to
 * start, while the page offers the agents it knows and says why. The fields
 * are the other way round: until they are read for the session and the
 * `reload` the page has now, nothing is ready, because a run must not be
 * started with inputs the page has not been told about.
 */
export function useNextData({
  ports,
  reload,
}: {
  readonly ports: NextPorts | undefined;
  /** Any value that, when it changes, asks for a fresh read. */
  readonly reload?: unknown;
}): NextData {
  const fields = useRead(ports, reload, takeExtras, NO_EXTRAS, FIELDS_FAILED);
  const agents = useRead(
    ports,
    reload,
    takeAgents,
    KNOWN_AGENTS,
    AGENTS_FAILED,
  );
  return {
    extras: fields.value,
    agents: agents.value,
    ready: fields.ready,
    ...(fields.failure === undefined ? {} : { failure: fields.failure }),
    ...(agents.failure === undefined ? {} : { agentsFailure: agents.failure }),
  };
}
