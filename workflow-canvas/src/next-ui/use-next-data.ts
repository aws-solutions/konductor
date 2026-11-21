// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { WorkflowExtras } from '../api/workflow-extras';
import type { AgentOption } from '../designer-view/field-rules';
import { KNOWN_AGENTS } from '../designer/core';
import type { NextPorts } from './next-http';

/** The fields and the agents that the views being built draw from. */
export interface NextData {
  readonly extras: WorkflowExtras;
  readonly agents: readonly AgentOption[];
  /** Why the reads failed; the views then fall back to what they can do. */
  readonly failure?: string;
}

const NO_EXTRAS: WorkflowExtras = { stageFields: {} };

/** What the views have before anything is read, and after a read fails. */
const NOTHING_READ: NextData = { extras: NO_EXTRAS, agents: KNOWN_AGENTS };

const READ_FAILED = 'The server did not give the fields of this workflow.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== ''
    ? error.message
    : READ_FAILED;
}

// What was read, and which session it was read through, so the fields of the
// workflow that was left are never shown under another one.
interface Read extends NextData {
  readonly ports: NextPorts;
  readonly reload: unknown;
}

/**
 * Reads the extra fields of the workflow and the list of agents once, and
 * again whenever `reload` changes, such as after a save, because a save can
 * change the keys a stage may have. The reads are aborted by the next one and
 * by unmounting, and no state is set after that.
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

  if (ports === undefined || read?.ports !== ports) return NOTHING_READ;
  return read.failure === undefined
    ? { extras: read.extras, agents: read.agents }
    : { extras: read.extras, agents: read.agents, failure: read.failure };
}
