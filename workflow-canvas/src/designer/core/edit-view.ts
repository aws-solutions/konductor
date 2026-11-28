// SPDX-License-Identifier: Apache-2.0
import type { EditableDocument, EditState } from './edit-state';
import { sameStages, stagesOf, type Draft, type DraftStage } from './draft';
import { hasErrors, withEchoes, type Problem } from './problems';
import { savedPrompts } from './saved-prompts';
import { inPlaceBlocker, withStages, type Written } from './stage-text';
import { paramsInPlaceBlocker, withParams } from './param-text';
import { outputEditBlocker, withOutputs } from './outputs-text';
import { withAcceptanceChecks } from './checks-spots';

/** The words that say why a read-only workflow cannot be changed. */
export const READ_ONLY_REASON = 'The workflow is read-only.';

/** Whether the stages may be changed: not when the server says read-only. */
export function canEdit(state: EditState): boolean {
  return !state.saved.readOnly;
}

/** The words that say why the stages cannot be changed while a file loads. */
export const RELOADING_REASON = 'The workflow is being loaded again.';

/** The words that say why the stages cannot be changed over a raw edit. */
export const RAW_EDIT_REASON =
  'The text of the workflow has been typed over, so the keys of a stage cannot be changed here. Save the text, or load the file again, first.';

/** The words that say why the stages cannot be changed while a text is sent. */
export const RAW_SAVE_REASON =
  'A text typed over the workflow is being saved. Wait for it to finish before changing the keys of a stage.';

/** The words that say why the text cannot be typed while a save is going on. */
export const SAVING_REASON =
  'The workflow is being saved, so typing is paused until the save finishes. The text can still be read and copied.';

/**
 * The text of a raw edit while one is pending, or `undefined` when there is
 * none. It is pending while the state holds it: the reducer drops it as soon
 * as it says nothing the form draft would not write anyway, so a text kept
 * here is always the one a save writes.
 */
export function rawTextOf(state: EditState): string | undefined {
  return state.raw;
}

/** Whether the save that is going on was sent a raw text. */
export function savingRawText(state: EditState): boolean {
  return state.save.phase === 'saving' && state.submitted?.kind === 'raw';
}

/** Why the stages cannot be changed now, or `undefined` when they can. */
export function changeBlocker(state: EditState): string | undefined {
  if (!canEdit(state)) return READ_ONLY_REASON;
  if (state.save.phase === 'reloading') return RELOADING_REASON;
  // A raw save reopens the draft from what the server parsed, so a change
  // made to the stages while it runs would be thrown away by its answer. A
  // form save keeps the draft, so it takes changes as it always has.
  if (savingRawText(state)) return RAW_SAVE_REASON;
  // The stages of the draft describe the file, not the text typed over it.
  return rawTextOf(state) === undefined ? undefined : RAW_EDIT_REASON;
}

/** Why no stage may be inserted now, or `undefined` when one may be. */
export function insertionBlocker(state: EditState): string | undefined {
  if (state.save.phase === 'saving') return SAVING_REASON;
  return changeBlocker(state);
}

/**
 * Why the text cannot be typed over now, or `undefined` when it can. Typing
 * pauses for the whole of any save: the answer settles what the file holds,
 * and a text typed in that window would be judged against the wrong one.
 */
export function textBlocker(state: EditState): string | undefined {
  if (!canEdit(state)) return READ_ONLY_REASON;
  if (state.save.phase === 'reloading') return RELOADING_REASON;
  return state.save.phase === 'saving' ? SAVING_REASON : undefined;
}

function emptyGoal(param: Draft['params'][number]): boolean {
  return (
    param.isGoal &&
    param.description === '' &&
    param.default === '' &&
    !param.required
  );
}

/** Whether the parameter draft differs from the saved view. */
export function paramsDirty(state: EditState): boolean {
  const saved = Object.entries(state.saved.view.params ?? {});
  if (saved.length !== state.paramBases.length) return true;
  for (const [index, [name, value]] of saved.entries()) {
    const id = state.paramBases[index];
    const param = state.draft.params.find((candidate) => candidate.id === id);
    if (
      !param ||
      name !== param.name ||
      (value.description ?? '') !== param.description ||
      (value.default ?? '') !== param.default ||
      (value.required ?? false) !== param.required
    ) {
      return true;
    }
  }
  const sourceIds = new Set(state.paramBases);
  return state.draft.params.some(
    (param) => !sourceIds.has(param.id) && !emptyGoal(param),
  );
}

function paramsForWrite(state: EditState): Draft['params'] {
  return state.draft.params.filter(
    (param) => state.paramBases.includes(param.id) || !emptyGoal(param),
  );
}

/** Parameter ids written by a parameter-changing submission. */
export function paramIdsForWrite(state: EditState): string[] {
  return paramsForWrite(state).map((param) => param.id);
}

/** Whether the acceptance-check draft differs from the saved view. */
export function acceptanceChecksDirty(state: EditState): boolean {
  const before = state.saved.view.intent.accept ?? [];
  const checks = state.draft.checks ?? [];
  return (
    before.length !== checks.length ||
    checks.some((check, index) => {
      const saved = before[index];
      return (
        !saved ||
        check.id !== saved.id ||
        check.kind !== (saved.run === undefined ? 'file' : 'run') ||
        check.file !== (saved.file ?? '') ||
        check.run.join('\0') !== (saved.run ?? []).join('\0')
      );
    })
  );
}

function acceptanceCheckRequests(state: EditState) {
  return (state.draft.checks ?? []).map(
    ({ id, kind, file, run, sourceIndex }) => ({
      id,
      kind,
      file,
      run,
      ...(sourceIndex === undefined ? {} : { source: sourceIndex }),
    }),
  );
}

/** Whether any stage output declaration differs from the saved view. */
export function outputsDirty(state: EditState): boolean {
  return state.draft.stages.some((stage) => {
    const from = state.bases.indexOf(stage.id);
    const before =
      from < 0 ? {} : (state.saved.view.stages[from]?.outputs ?? {});
    const entries = Object.entries(before);
    const outputs = stage.outputs ?? [];
    return (
      entries.length !== outputs.length ||
      outputs.some(
        (output, index) =>
          output.name !== entries[index]?.[0] ||
          output.path !== entries[index]?.[1],
      )
    );
  });
}

function outputRequests(state: EditState) {
  return state.draft.stages.map((stage) => {
    const from = state.bases.indexOf(stage.id);
    return {
      outputs: (stage.outputs ?? []).map(({ name, path, sourceIndex }) => ({
        name,
        path,
        ...(sourceIndex === undefined ? {} : { source: sourceIndex }),
      })),
      before: from < 0 ? {} : (state.saved.view.stages[from]?.outputs ?? {}),
    };
  });
}

// Whether the stages, params, outputs, checks or prompts differ from the file.
function formDirty(state: EditState): boolean {
  if (!sameStages(stagesOf(state.draft), state.saved.view.stages)) return true;
  if (paramsDirty(state)) return true;
  if (outputsDirty(state)) return true;
  if (acceptanceChecksDirty(state)) return true;
  // A file whose prompts cannot be read has none that the draft could change.
  const spots = savedPrompts(state.saved);
  return (
    spots !== undefined &&
    state.draft.stages.some((stage, i) => stage.prompt !== spots[i]?.text)
  );
}

/** Whether the draft differs from the saved workflow. */
export function isDirty(state: EditState): boolean {
  return rawTextOf(state) !== undefined || formDirty(state);
}

// The writer reads the whole file, which takes a few milliseconds for a large
// one, and one render asks for its result several times: Save, the alerts and
// the editor. The result depends only on the saved document, the draft and
// `bases`, which a change replaces and never mutates, so it is kept for each
// draft and used again while the other two are the same objects.
const written = new WeakMap<
  Draft,
  { saved: EditableDocument; bases: readonly string[]; result: Written }
>();
const fileReasons = new WeakMap<
  EditableDocument,
  { reason: string | undefined }
>();

/**
 * What a save would write: the saved text with the draft's stages, each
 * edited in place in the item of the stage it was, or the reason the change
 * cannot be written in place.
 */
export function writtenOf(state: EditState): Written {
  const { saved, draft, bases } = state;
  const kept = written.get(draft);
  if (kept && kept.saved === saved && kept.bases === bases) return kept.result;
  const spots = savedPrompts(saved);
  const stages = draft.stages.map(({ id, name, agent, prompt }) => {
    const from = bases.indexOf(id);
    // A stage of the file asks for a prompt only when it was typed over; a new
    // stage asks for its own, which may take the item of a deleted one.
    if (from < 0) return { name, agent, prompt };
    const changed = prompt !== (spots?.[from]?.text ?? '');
    return changed ? { name, agent, from, prompt } : { name, agent, from };
  });
  const staged = withStages(saved.text, saved.view, stages);
  const withStageOutputs =
    staged.ok && outputsDirty(state)
      ? withOutputs(staged.text, outputRequests(state))
      : staged;
  const withChecks =
    withStageOutputs.ok && acceptanceChecksDirty(state)
      ? withAcceptanceChecks(
          withStageOutputs.text,
          acceptanceCheckRequests(state),
        )
      : withStageOutputs;
  const result =
    withChecks.ok && paramsDirty(state)
      ? withParams(
          withChecks.text,
          paramsForWrite(state).map((param) => {
            const from = state.paramBases.indexOf(param.id);
            const original =
              from < 0
                ? undefined
                : Object.entries(saved.view.params ?? {})[from];
            return {
              name: param.name,
              description: param.description,
              default: param.default,
              required: param.required,
              ...(from < 0 ? {} : { from }),
              ...(original
                ? {
                    before: {
                      name: original[0],
                      description: original[1].description,
                      default: original[1].default,
                      required: original[1].required,
                    },
                  }
                : {}),
            };
          }),
          saved.view.params !== undefined,
        )
      : withChecks;
  written.set(draft, { saved, bases, result });
  return result;
}

/**
 * The text that a save would write, or `undefined` when it cannot be
 * written. A raw edit is that text already, so the writer is not used for it.
 */
export function textOf(state: EditState): string | undefined {
  const raw = rawTextOf(state);
  if (raw !== undefined) return raw;
  return formTextOf(state);
}

/**
 * The text the form draft alone would write, with no raw edit in the way, or
 * `undefined` when the writer cannot write it in place. Typing this into the
 * YAML box is how an author takes a raw edit back.
 */
export function formTextOf(state: EditState): string | undefined {
  const written = writtenOf(state);
  return written.ok ? written.text : undefined;
}

/**
 * Why the draft cannot be written in place, or `undefined` when it can. A
 * raw edit writes the whole file, so nothing has to be written in place.
 */
export function writeBlocker(state: EditState): string | undefined {
  if (rawTextOf(state) !== undefined) return undefined;
  const written = writtenOf(state);
  return written.ok ? undefined : written.reason;
}

/** Why parameter declarations cannot be changed now. */
export function paramsBlocker(state: EditState): string | undefined {
  return (
    changeBlocker(state) ??
    paramsInPlaceBlocker(
      state.saved.text,
      state.saved.view.params !== undefined,
    )
  );
}

/** Why one stage's output declarations cannot make this kind of edit. */
export function outputsBlocker(
  state: EditState,
  stageId: string,
  structural = false,
): string | undefined {
  const blocked = changeBlocker(state);
  if (blocked) return blocked;
  const sourceIndex = state.bases.indexOf(stageId);
  return sourceIndex < 0
    ? undefined
    : outputEditBlocker(state.saved.text, sourceIndex, structural);
}

/**
 * Why no change to the stages of the saved file can be written in place, or
 * `undefined`: a file-wide reason, known before any change is made.
 */
export function fileBlocker(state: EditState): string | undefined {
  const { saved } = state;
  const kept = fileReasons.get(saved);
  if (kept) return kept.reason;
  const reason = inPlaceBlocker(saved.text, saved.view);
  fileReasons.set(saved, { reason });
  return reason;
}

// The findings that speak for the draft as it is now. After a change they are
// gone until the check of the new draft answers; a check that failed has no
// event, so Save is open again then and the server checks the text on save.
function currentFindings(state: EditState) {
  return state.check.revision === state.revision ? state.check.diagnostics : [];
}

/**
 * The problems to show: those of the latest check, which stay on show while
 * the check of the new draft is still to come, so the page does not flicker
 * at every key. A problem of a stage that was deleted is dropped, and a
 * repeated name is marked on the earlier stage as well (see `withEchoes`).
 */
export function problemsOfDraft(state: EditState): Problem[] {
  const ids = new Set(state.draft.stages.map((stage) => stage.id));
  const present = state.check.problems.filter(
    (problem) => problem.stageId === undefined || ids.has(problem.stageId),
  );
  return withEchoes(present, state.draft);
}

/** Why the draft cannot be saved now, or `undefined` when it can. */
export function saveBlocker(state: EditState): string | undefined {
  if (!canEdit(state)) return READ_ONLY_REASON;
  switch (state.save.phase) {
    case 'saving':
      return 'The workflow is being saved.';
    case 'reloading':
      return RELOADING_REASON;
    case 'conflict':
      return 'The file changed on disk. Reload it first.';
    default:
      break;
  }
  if (!isDirty(state)) return 'There are no changes to save.';
  const unwritable = writeBlocker(state);
  if (unwritable !== undefined) return unwritable;
  return hasErrors(currentFindings(state))
    ? 'Fix the problems in the workflow first.'
    : undefined;
}

/** Whether the draft can be saved now. */
export function canSave(state: EditState): boolean {
  return saveBlocker(state) === undefined;
}

/** How the status line shows the state of saving. */
export type SaveStatusKind = 'pending' | 'warning' | 'in-progress' | 'success';

/** The words and the kind of the line that says whether work is saved. */
export function saveStatus(state: EditState): {
  kind: SaveStatusKind;
  text: string;
} {
  const { phase } = state.save;
  if (phase === 'saving') return { kind: 'in-progress', text: 'Saving' };
  if (phase === 'reloading') return { kind: 'in-progress', text: 'Loading' };
  if (isDirty(state)) return { kind: 'warning', text: 'Unsaved changes' };
  if (phase === 'saved') return { kind: 'success', text: 'Saved' };
  if (phase === 'reloaded') {
    return { kind: 'success', text: 'Loaded again from the server' };
  }
  return { kind: 'pending', text: 'No changes' };
}

/** What the Properties pane offers for the prompt of a stage. */
export type PromptField =
  /** The text can be typed. */
  | { kind: 'text' }
  /** The stage reads a file, whose path is shown and not changed. */
  | { kind: 'file'; path: string }
  /** The stage has `prompt` and `prompt_file`, which the check reports. */
  | { kind: 'both'; path: string }
  /** The editor cannot tell the prompt, for the `reason`. */
  | { kind: 'blocked'; reason: string };

const UNREAD =
  'The editor cannot tell where the prompts of this file are, so it cannot change them.';

/** The way the prompt of the stage is shown in Properties. */
export function promptFieldOf(
  state: EditState,
  stage: DraftStage,
): PromptField {
  const spots = savedPrompts(state.saved);
  if (!spots) return { kind: 'blocked', reason: UNREAD };
  const from = state.bases.indexOf(stage.id);
  const spot = from < 0 ? undefined : spots[from];
  if (spot?.refuse) return { kind: 'blocked', reason: spot.refuse };
  switch (spot?.state) {
    case 'file':
      return { kind: 'file', path: spot.file ?? '' };
    case 'both':
      return { kind: 'both', path: spot.file ?? '' };
    case 'blocked':
      return { kind: 'blocked', reason: spot.reason ?? UNREAD };
    default:
      return { kind: 'text' };
  }
}
