// SPDX-License-Identifier: Apache-2.0
import type { EditState } from './edit-state';
import { sameStages, stagesOf } from './draft';
import { hasErrors, withEchoes, type Problem } from './problems';
import { withStages } from './stage-text';

/** The words that say why a read-only workflow cannot be changed. */
export const READ_ONLY_REASON = 'The workflow is read-only.';

/** Whether the stages may be changed: not when the server says read-only. */
export function canEdit(state: EditState): boolean {
  return !state.saved.readOnly;
}

/** Whether the draft differs from the saved workflow. */
export function isDirty(state: EditState): boolean {
  return !sameStages(stagesOf(state.draft), state.saved.view.stages);
}

/** The text that a save would write: the saved text with the draft's stages. */
export function textOf(state: EditState): string {
  const { text, view } = state.saved;
  return withStages(text, view, stagesOf(state.draft));
}

// The findings that speak for the draft as it is now.
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
      return 'The workflow is being loaded again.';
    case 'conflict':
      return 'The file changed on disk. Reload it first.';
    default:
      break;
  }
  if (!isDirty(state)) return 'There are no changes to save.';
  return hasErrors(currentFindings(state))
    ? 'Fix the problems in the workflow first.'
    : undefined;
}

/** Whether the draft can be saved now. */
export function canSave(state: EditState): boolean {
  return saveBlocker(state) === undefined;
}
