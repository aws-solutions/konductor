// SPDX-License-Identifier: Apache-2.0
import { useMemo, useReducer, useState } from 'react';
import type { LoadedWorkflow } from '../workflow/load-workflow';
import { reduce, type EditState } from './core';

/** The state of the Designer's editing and the ways to change it. */
export interface Editor {
  state: EditState;
  select(id: string): void;
  add(): void;
  rename(id: string, name: string): void;
  setAgent(id: string, agent: string): void;
  remove(id: string): void;
}

/**
 * Keeps the editing of `workflow` for as long as the page lives, so the
 * draft survives a switch of tab. It is `undefined` until there is a workflow
 * with a file to edit.
 */
export function useEditor(
  workflow: LoadedWorkflow | undefined,
): Editor | undefined {
  const [state, dispatch] = useReducer(reduce, undefined);
  const [opened, setOpened] = useState<LoadedWorkflow>();

  // Open the draft in the same render that gets the workflow, so the page
  // never shows a workflow it has no editor for.
  if (workflow !== opened) {
    setOpened(workflow);
    if (workflow) dispatch({ type: 'open', document: workflow.document });
  }

  return useMemo(
    () =>
      state && {
        state,
        select: (id) => dispatch({ type: 'select', id }),
        add: () => dispatch({ type: 'add' }),
        rename: (id, name) => dispatch({ type: 'rename', id, name }),
        setAgent: (id, agent) => dispatch({ type: 'set-agent', id, agent }),
        remove: (id) => dispatch({ type: 'remove', id }),
      },
    [state],
  );
}
