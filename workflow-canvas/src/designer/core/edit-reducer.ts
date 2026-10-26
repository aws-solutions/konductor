// SPDX-License-Identifier: Apache-2.0
import type {
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
} from '../../api/types';
import {
  addStage,
  canAddStage,
  canRemoveStage,
  neighbourOf,
  removeStage,
  renameStage,
  setAgent,
  type Draft,
} from './draft';
import { openDocument, type EditEvent, type EditState } from './edit-state';
import { canSave } from './edit-view';

const NOT_EDITABLE =
  'The workflow on the server can no longer be edited here. Fix the file and reload the page.';

// A change of the draft: a new revision, and a finished save is old news.
function edited(state: EditState, draft: Draft, selectedId: string): EditState {
  if (draft === state.draft) return state;
  const phase = state.save.phase;
  const settled =
    phase === 'saved' || phase === 'reloaded' || phase === 'failed';
  return {
    ...state,
    draft,
    selectedId,
    revision: state.revision + 1,
    save: settled ? { phase: 'idle' } : state.save,
  };
}

function removed(state: EditState, id: string): EditState {
  if (!canRemoveStage(state.draft)) return state;
  const draft = removeStage(state.draft, id);
  const next =
    id === state.selectedId ? neighbourOf(state.draft, id) : state.selectedId;
  return edited(state, draft, next ?? state.selectedId);
}

function added(state: EditState): EditState {
  if (!canAddStage(state.draft)) return state;
  const draft = addStage(state.draft);
  return edited(state, draft, draft.stages.at(-1)?.id ?? state.selectedId);
}

function renamed(state: EditState, id: string, name: string): EditState {
  const stage = state.draft.stages.find((candidate) => candidate.id === id);
  if (!stage || stage.name === name) return state;
  return edited(state, renameStage(state.draft, id, name), state.selectedId);
}

function agentSet(state: EditState, id: string, agent: string): EditState {
  const stage = state.draft.stages.find((candidate) => candidate.id === id);
  if (!stage || stage.agent === agent) return state;
  return edited(state, setAgent(state.draft, id, agent), state.selectedId);
}

function selected(state: EditState, id: string): EditState {
  return state.draft.stages.some((stage) => stage.id === id)
    ? { ...state, selectedId: id }
    : state;
}

function checked(
  state: EditState,
  revision: number,
  diagnostics: readonly DiagnosticView[],
): EditState {
  return revision === state.revision
    ? { ...state, check: { revision, diagnostics } }
    : state;
}

function savedAs(
  state: EditState,
  text: string,
  result: SaveResult,
): EditState {
  return {
    ...state,
    saved: {
      ...state.saved,
      text,
      hash: result.hash,
      view: result.view,
      diagnostics: result.diagnostics,
    },
    save: { phase: 'saved' },
  };
}

// Findings of a refused save are for the draft that was sent; if the draft
// has changed since, the next check will speak for the new one.
function refused(
  state: EditState,
  revision: number,
  diagnostics: readonly DiagnosticView[],
): EditState {
  const next: EditState = { ...state, save: { phase: 'idle' } };
  return revision === state.revision
    ? { ...next, check: { revision, diagnostics } }
    : next;
}

function reloaded(state: EditState, document: WorkflowDocument): EditState {
  const next = openDocument(document);
  return next
    ? { ...next, save: { phase: 'reloaded' } }
    : { ...state, save: { phase: 'conflict', problem: NOT_EDITABLE } };
}

/**
 * The next state after an event, or `undefined` while there is nothing to
 * edit. An event that does not fit, such as a save with nothing to save or a
 * check for an older draft, changes nothing.
 */
export function reduce(
  state: EditState | undefined,
  event: EditEvent,
): EditState | undefined {
  if (event.type === 'open') return openDocument(event.document);
  if (!state) return undefined;
  switch (event.type) {
    case 'select':
      return selected(state, event.id);
    case 'add':
      return added(state);
    case 'rename':
      return renamed(state, event.id, event.name);
    case 'set-agent':
      return agentSet(state, event.id, event.agent);
    case 'remove':
      return removed(state, event.id);
    case 'checked':
      return checked(state, event.revision, event.diagnostics);
    case 'save':
      return canSave(state) ? { ...state, save: { phase: 'saving' } } : state;
    case 'saved':
      return savedAs(state, event.text, event.result);
    case 'conflict':
      return { ...state, save: { phase: 'conflict' } };
    case 'refused':
      return refused(state, event.revision, event.diagnostics);
    case 'failed':
      return { ...state, save: { phase: 'failed', message: event.message } };
    case 'reload':
      return { ...state, save: { phase: 'reloading' } };
    case 'reloaded':
      return reloaded(state, event.document);
    case 'reload-failed':
      return { ...state, save: { phase: 'conflict', problem: event.message } };
  }
}
