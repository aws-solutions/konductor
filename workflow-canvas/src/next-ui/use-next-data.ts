// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
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
   * now. It is false while a read is in flight and after one that failed, so
   * a view can tell a field the workflow does not declare from one it has not
   * been told about yet.
   */
  readonly ready: boolean;
  /** Why the reads failed; the views then fall back to what they can do. */
  readonly failure?: string;
}

const NO_EXTRAS: WorkflowExtras = { stageFields: {} };

/** What the views have before anything is read, and after a read fails. */
const NOTHING_READ: NextData = {
  extras: NO_EXTRAS,
  agents: KNOWN_AGENTS,
  ready: false,
};

const READ_FAILED = 'The server did not give the fields of this workflow.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : READ_FAILED;
}

// What was read, and which session it was read through, so the fields of the
// workflow that was left are never shown under another one. Readiness is not
// kept here: it is whether this answer is the one the page is asking for and
// nothing failed, which the hook works out as it returns.
interface Read extends Omit<NextData, 'ready'> {
  readonly ports: NextPorts;
  readonly reload: unknown;
}

/**
 * Reads the extra fields of the workflow and the list of agents once, and
 * again whenever `reload` changes, such as after a save, because a save can
 * change the keys a stage may have. The reads are aborted by the next one and
 * by unmounting, and no state is set after that. While a read is in flight
 * the views have nothing, so none of them shows what the workflow held before
 * it.
 *
 * What was read belongs to the session it was read through: another `ports`
 * object is another workflow, so the fields and the agents start again from
 * nothing until it answers. A read that fails is the same: the field rules go
 * back to none and the agents to the ones this page knows, beside the reason,
 * so no view offers the constraints of a workflow that is no longer open.
 */
export function useNextData({
  ports,
  reload,
}: {
  readonly ports: NextPorts | undefined;
  /** Any value that, when it changes, asks for a fresh read. */
  readonly reload?: unknown;
}): NextData {
  const [read, setRead] = useState<Read>();
  const latest = useRef(ports);

  useEffect(() => {
    latest.current = ports;
  });

  useEffect(() => {
    if (ports === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    const take = async () => {
      const [extras, agents] = await Promise.all([
        ports.loadExtras(signal),
        ports.listAgents(signal),
      ]);
      if (!signal.aborted) setRead({ ports, reload, extras, agents });
    };
    void take().catch((error: unknown) => {
      if (!signal.aborted) {
        setRead({ ports, reload, ...NOTHING_READ, failure: messageOf(error) });
      }
    });
    return () => controller.abort();
  }, [ports, reload]);

  // What was read answers for one session and for one `reload`. A fresh read
  // is in flight until it has set both, and until then the views have
  // nothing: the fields a workflow had before a save are not the fields it
  // has now, and a run must not be started with the default goal it had.
  if (ports === undefined || read?.ports !== ports || read.reload !== reload) {
    return NOTHING_READ;
  }
  return read.failure === undefined
    ? { extras: read.extras, agents: read.agents, ready: true }
    : {
        extras: read.extras,
        agents: read.agents,
        ready: false,
        failure: read.failure,
      };
}
