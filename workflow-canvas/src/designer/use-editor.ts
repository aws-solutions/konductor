// SPDX-License-Identifier: Apache-2.0
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type { Scheduler } from '../execution/core';
import type { LoadedWorkflow } from '../workflow/load-workflow';
import {
  checkAfterPause,
  canSave,
  reduce,
  reloadWorkflow,
  saveDraft,
  textOf,
  type EditState,
} from './core';

/** The state of the Designer's editing and the ways to change it. */
export interface Editor {
  state: EditState;
  select(id: string): void;
  add(): void;
  rename(id: string, name: string): void;
  setAgent(id: string, agent: string): void;
  remove(id: string): void;
  /** Writes the draft; does nothing when it cannot be saved. */
  save(): void;
  /** Loads the workflow from the server again, dropping the draft. */
  reload(): void;
}

/**
 * Keeps the editing of `workflow` for as long as the page lives, so the
 * draft survives a switch of tab. It is `undefined` until there is a workflow
 * with a file to edit. The text is checked a moment after each change, waiting
 * with `scheduler`, and the check is dropped when the text changes again.
 */
export function useEditor(
  workflow: LoadedWorkflow | undefined,
  scheduler: Scheduler,
): Editor | undefined {
  const [state, dispatch] = useReducer(reduce, undefined);
  const [opened, setOpened] = useState<LoadedWorkflow>();
  const busy = useRef(false);

  // Open the draft in the same render that gets the workflow, so the page
  // never shows a workflow it has no editor for.
  if (workflow !== opened) {
    setOpened(workflow);
    if (workflow) dispatch({ type: 'open', document: workflow.document });
  }

  const edits = workflow?.edits;
  const revision = state?.revision;
  const text = useMemo(() => (state ? textOf(state) : undefined), [state]);
  const unchecked = state !== undefined && state.check.revision !== revision;

  useEffect(() => {
    if (!edits || revision === undefined || text === undefined || !unchecked) {
      return;
    }
    const controller = new AbortController();
    void checkAfterPause({
      edits,
      scheduler,
      text,
      revision,
      emit: dispatch,
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [edits, scheduler, revision, text, unchecked]);

  const save = useCallback(() => {
    if (!edits || !state || text === undefined) return;
    if (busy.current || !canSave(state)) return;
    busy.current = true;
    dispatch({ type: 'save' });
    void saveDraft({
      edits,
      text,
      baseHash: state.saved.hash,
      revision: state.revision,
      emit: dispatch,
    }).finally(() => {
      busy.current = false;
    });
  }, [edits, state, text]);

  const reload = useCallback(() => {
    if (!edits || busy.current) return;
    busy.current = true;
    dispatch({ type: 'reload' });
    void reloadWorkflow(edits, dispatch).finally(() => {
      busy.current = false;
    });
  }, [edits]);

  return useMemo(
    () =>
      state && {
        state,
        select: (id) => dispatch({ type: 'select', id }),
        add: () => dispatch({ type: 'add' }),
        rename: (id, name) => dispatch({ type: 'rename', id, name }),
        setAgent: (id, agent) => dispatch({ type: 'set-agent', id, agent }),
        remove: (id) => dispatch({ type: 'remove', id }),
        save,
        reload,
      },
    [state, save, reload],
  );
}
