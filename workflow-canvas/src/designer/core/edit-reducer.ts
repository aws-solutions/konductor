// SPDX-License-Identifier: Apache-2.0
import type {
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
} from '../../api/types';
import {
  addCheck,
  addOutput,
  addParam,
  addStage,
  canAddStage,
  canRemoveStage,
  idsOf,
  insertStage,
  neighbourOf,
  rebaseCheckSources,
  rebaseOutputSources,
  removeCheck,
  removeOutput,
  removeParam,
  removeStage,
  renameStage,
  setAgent,
  setCheck,
  setOutput,
  setParam,
  setPrompt,
  type Draft,
} from './draft';
import {
  openDocument,
  type EditEvent,
  type EditSlot,
  type EditState,
  type SaveState,
  type Submission,
} from './edit-state';
import {
  canSave,
  changeBlocker,
  formTextOf,
  insertionBlocker,
  isDirty,
  paramIdsForWrite,
  paramsDirty,
  rawTextOf,
  textBlocker,
  textOf,
} from './edit-view';
import { checkOf } from './problems';

const NOT_EDITABLE =
  'The workflow on the server can no longer be edited here. Fix the file and reload the page.';

// A change of the draft: a new revision, and a finished save is old news.
// A read-only workflow takes no change.
function edited(state: EditState, draft: Draft, selectedId: string): EditState {
  if (draft === state.draft || changeBlocker(state) !== undefined) return state;
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

function inserted(state: EditState, index: number, agent: string): EditState {
  if (insertionBlocker(state) !== undefined || !canAddStage(state.draft)) {
    return state;
  }
  const draft = insertStage(state.draft, index, agent);
  const selectedId = draft.stages[Math.min(index, draft.stages.length - 1)]?.id;
  return edited(state, draft, selectedId ?? state.selectedId);
}

function added(state: EditState): EditState {
  if (insertionBlocker(state) !== undefined || !canAddStage(state.draft)) {
    return state;
  }
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

function promptSet(state: EditState, id: string, prompt: string): EditState {
  const stage = state.draft.stages.find((candidate) => candidate.id === id);
  if (!stage || stage.prompt === prompt) return state;
  return edited(state, setPrompt(state.draft, id, prompt), state.selectedId);
}

function outputSet(
  state: EditState,
  stageId: string,
  outputId: string,
  output: { name: string; path: string },
): EditState {
  return edited(
    state,
    setOutput(state.draft, stageId, outputId, output),
    state.selectedId,
  );
}

function outputAdded(state: EditState, stageId: string): EditState {
  return edited(state, addOutput(state.draft, stageId), state.selectedId);
}

function outputRemoved(
  state: EditState,
  stageId: string,
  outputId: string,
): EditState {
  return edited(
    state,
    removeOutput(state.draft, stageId, outputId),
    state.selectedId,
  );
}

function checkSet(
  state: EditState,
  event: Extract<EditEvent, { type: 'set-check' }>,
): EditState {
  return edited(
    state,
    setCheck(state.draft, event.key, event.check),
    state.selectedId,
  );
}

function checkAdded(state: EditState): EditState {
  return edited(state, addCheck(state.draft), state.selectedId);
}

function checkRemoved(state: EditState, key: string): EditState {
  return edited(state, removeCheck(state.draft, key), state.selectedId);
}

function paramSet(
  state: EditState,
  id: string,
  change: Extract<EditEvent, { type: 'set-param' }>['change'],
): EditState {
  const param = state.draft.params.find((candidate) => candidate.id === id);
  if (!param) return state;
  const draft = setParam(state.draft, id, change);
  return edited(state, draft, state.selectedId);
}

function paramAdded(state: EditState): EditState {
  return edited(state, addParam(state.draft), state.selectedId);
}

function paramRemoved(state: EditState, id: string): EditState {
  return edited(state, removeParam(state.draft, id), state.selectedId);
}

function selected(state: EditState, id: string): EditState {
  return state.draft.stages.some((stage) => stage.id === id)
    ? { ...state, selectedId: id }
    : state;
}

/**
 * The whole text typed over. It keeps the text, bumps the revision so the
 * check runs for it, and leaves the draft as it is: its stages describe the
 * file, so they are stale until a save or a reload gives the editor the
 * server's parse of the new text. `changeBlocker` refuses a form edit while
 * one is pending, which is why nothing here has to re-read the YAML; the
 * core has no parser of its own and the check is the one that answers.
 *
 * The text is compared with the one a save would write now, not with the
 * file: with a form edit pending, typing the file back is a change, and it
 * is how the author drops that edit. Typing the text the form draft would
 * write takes the raw edit back instead, and it is dropped from the state
 * rather than hidden, so it cannot come back when the form changes again.
 */
function textSet(state: EditState, text: string): EditState {
  if (textBlocker(state) !== undefined) return state;
  if (text === (textOf(state) ?? state.saved.text)) return state;
  const settled = settledSave(state);
  if (text === formTextOf(state)) {
    return {
      ...withoutRaw(state),
      revision: state.revision + 1,
      ...(settled ? { save: { phase: 'idle' } as SaveState } : {}),
    };
  }
  return {
    ...state,
    raw: text,
    revision: state.revision + 1,
    ...(settled ? { save: { phase: 'idle' } as SaveState } : {}),
  };
}

// A finished save is old news once the draft changes again.
function settledSave(state: EditState): boolean {
  const { phase } = state.save;
  return phase === 'saved' || phase === 'reloaded' || phase === 'failed';
}

// Drops the raw text, so nothing is left to become the payload again.
function withoutRaw(state: EditState): EditState {
  const next = { ...state };
  delete next.raw;
  return next;
}

// A raw text that no longer differs from what the form draft would write has
// nothing left to say, so it goes rather than waiting to reappear.
function withoutStaleRaw(state: EditState): EditState {
  const raw = state.raw;
  return raw !== undefined && raw === formTextOf(state)
    ? withoutRaw(state)
    : state;
}

function checked(
  state: EditState,
  revision: number,
  diagnostics: readonly DiagnosticView[],
): EditState {
  return revision === state.revision
    ? { ...state, check: checkOf(revision, diagnostics, state.draft) }
    : state;
}

// A raw edit sent the whole file, so the ids of the draft describe the text
// before it. What the server parsed of what was written is the new truth, so
// the state opens again from it rather than keeping stages that no longer
// point anywhere. A save of a form edit never reaches this.
// A raw edit sent the whole file, so the ids of the draft describe the text
// before it. What the server parsed of what was written is the new truth, so
// the state opens again from it rather than keeping stages that no longer
// point anywhere. A save of a form edit never reaches this. Nothing can have
// been typed since: editing pauses for the whole save.
function openedAfterRaw(
  state: EditState,
  text: string,
  result: SaveResult,
): EditState {
  const next = openDocument(
    {
      ...state.saved,
      text,
      hash: result.hash,
      view: result.view,
      diagnostics: result.diagnostics,
    },
    state.revision,
  );
  return next
    ? { ...next, revision: state.revision, save: { phase: 'saved' } }
    : { ...state, save: { phase: 'conflict', problem: NOT_EDITABLE } };
}

// What a save is being asked to write, kept so its answer is applied to that
// text and not to whatever the editor holds when the answer arrives.
function submissionOf(state: EditState): Submission {
  return {
    kind: rawTextOf(state) === undefined ? 'form' : 'raw',
    text: textOf(state) ?? state.saved.text,
    revision: state.revision,
  };
}

function savedAs(
  state: EditState,
  text: string,
  result: SaveResult,
): EditState {
  if (state.submitted?.kind === 'raw') {
    return openedAfterRaw(state, text, result);
  }
  // The file now holds the stages that were sent, in the order they were.
  const next: EditState = {
    ...state,
    draft: rebaseCheckSources(
      rebaseOutputSources(
        state.draft,
        result.view.stages,
        state.sentOutputs ?? [],
      ),
      result.view.intent.accept ?? [],
    ),
    saved: {
      ...state.saved,
      text,
      hash: result.hash,
      view: result.view,
      diagnostics: result.diagnostics,
    },
    bases: state.sent ?? idsOf(state.draft),
    paramBases: state.sentParams ?? state.draft.params.map((param) => param.id),
    sent: undefined,
    sentOutputs: undefined,
    sentParams: undefined,
    save: { phase: 'saved' },
  };
  // What was saved is what the findings of the save are about; if the draft
  // changed meanwhile, the check of its new revision will speak.
  const settled = withoutDiscarded(next);
  return isDirty(settled)
    ? settled
    : {
        ...settled,
        check: checkOf(state.revision, result.diagnostics, state.draft),
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
    ? { ...next, check: checkOf(revision, diagnostics, state.draft) }
    : next;
}

function withoutDiscarded(state: EditState): EditState {
  return { ...state, discarded: undefined };
}

function reloaded(
  state: EditState,
  document: WorkflowDocument,
  revision: number,
): EditState {
  const next = openDocument(document, revision);
  // The reload replaces the draft; its text is kept so it can be recovered.
  // A draft with a change the writer cannot write in place has no text, so
  // nothing is kept for it.
  const discarded = isDirty(state) ? textOf(state) : undefined;
  return next
    ? {
        ...next,
        save: { phase: 'reloaded' },
        ...(discarded === undefined ? {} : { discarded }),
      }
    : { ...state, save: { phase: 'conflict', problem: NOT_EDITABLE } };
}

// The answer to a save counts only while that save is going on; a late answer
// to an earlier one, such as one that comes after a reload, changes nothing.
function whileSaving(state: EditState, apply: () => EditState): EditState {
  return state.save.phase === 'saving' ? apply() : state;
}

function whileReloading(state: EditState, apply: () => EditState): EditState {
  return state.save.phase === 'reloading' ? apply() : state;
}

// A lost session is shown at once, unless a save or a load is going on: its
// own answer will say so.
function sessionLost(state: EditState, message: string): EditState {
  const { phase } = state.save;
  return phase === 'saving' || phase === 'reloading'
    ? state
    : { ...state, save: { phase: 'failed', message, sessionLost: true } };
}

function failure(message: string, uncertain: true | undefined): SaveState {
  return uncertain
    ? { phase: 'failed', message, uncertain }
    : { phase: 'failed', message };
}

function step(
  state: EditState | undefined,
  event: EditEvent,
  nextRevision: number,
): EditState | undefined {
  if (event.type === 'open') return openDocument(event.document, nextRevision);
  if (!state) return undefined;
  switch (event.type) {
    case 'select':
      return selected(state, event.id);
    case 'add':
      return added(state);
    case 'insert':
      return inserted(state, event.index, event.agent);
    case 'rename':
      return renamed(state, event.id, event.name);
    case 'set-agent':
      return agentSet(state, event.id, event.agent);
    case 'set-prompt':
      return promptSet(state, event.id, event.prompt);
    case 'set-output':
      return outputSet(state, event.stageId, event.outputId, event.output);
    case 'add-output':
      return outputAdded(state, event.stageId);
    case 'remove-output':
      return outputRemoved(state, event.stageId, event.outputId);
    case 'set-check':
      return checkSet(state, event);
    case 'add-check':
      return checkAdded(state);
    case 'remove-check':
      return checkRemoved(state, event.key);
    case 'set-param':
      return paramSet(state, event.id, event.change);
    case 'add-param':
      return paramAdded(state);
    case 'remove-param':
      return paramRemoved(state, event.id);
    case 'set-text':
      return textSet(state, event.text);
    case 'remove':
      return removed(state, event.id);
    case 'checked':
      return checked(state, event.revision, event.diagnostics);
    case 'save':
      return canSave(state)
        ? {
            ...state,
            save: { phase: 'saving' },
            sent: idsOf(state.draft),
            sentOutputs: state.draft.stages.map((stage) => ({
              stageId: stage.id,
              outputIds: (stage.outputs ?? []).map(({ id }) => id),
            })),
            sentParams: paramsDirty(state)
              ? paramIdsForWrite(state)
              : state.paramBases.filter((id) =>
                  state.draft.params.some((param) => param.id === id),
                ),
            submitted: submissionOf(state),
          }
        : state;
    case 'saved':
      return whileSaving(state, () =>
        withoutStaleRaw(savedAs(state, event.text, event.result)),
      );
    case 'conflict':
      return whileSaving(state, () => ({
        ...state,
        save: { phase: 'conflict' },
      }));
    case 'refused':
      return whileSaving(state, () =>
        refused(state, event.revision, event.diagnostics),
      );
    case 'failed':
      return whileSaving(state, () => ({
        ...state,
        save: failure(event.message, event.uncertain),
      }));
    case 'session-lost':
      return sessionLost(state, event.message);
    case 'reload':
      return { ...withoutDiscarded(state), save: { phase: 'reloading' } };
    case 'reloaded':
      return whileReloading(state, () =>
        reloaded(state, event.document, nextRevision),
      );
    case 'reload-failed':
      return whileReloading(state, () => ({
        ...state,
        save: { phase: 'conflict', problem: event.message },
      }));
  }
}

/**
 * The next state after an event, or `undefined` while there is nothing to
 * edit. An event that does not fit, such as a save with nothing to save or a
 * check for an older draft, changes nothing. It cannot remember revisions
 * across an `undefined` state; the editor uses `reduceSlot`.
 */
export function reduce(
  state: EditState | undefined,
  event: EditEvent,
): EditState | undefined {
  return step(state, event, state ? state.revision + 1 : 0);
}

/** Like `reduce`, but no revision is reused after the state was `undefined`. */
export function reduceSlot(slot: EditSlot, event: EditEvent): EditSlot {
  const current = step(slot.current, event, slot.lastRevision + 1);
  if (current === slot.current) return slot;
  return {
    current,
    lastRevision: Math.max(slot.lastRevision, current?.revision ?? -1),
  };
}
