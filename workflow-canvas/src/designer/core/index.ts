// SPDX-License-Identifier: Apache-2.0
/**
 * The core of the Designer's editing: the draft of the stages, the text that
 * a save writes, the state of the editor and its reducer, and the loops that
 * check and save. It does no IO; the calls of the API and the time come in
 * through its ports.
 * @module
 */
export { agentChoices, KNOWN_AGENTS, type KnownAgent } from './agents';
export {
  canAddStage,
  canRemoveStage,
  DEFAULT_AGENT,
  MAX_STAGES,
  nextStageName,
  type Draft,
  type DraftStage,
} from './draft';
export { reduce, reduceSlot } from './edit-reducer';
export {
  EMPTY_SLOT,
  isEditable,
  openDocument,
  type EditableDocument,
  type EditEvent,
  type EditSlot,
  type EditState,
  type SaveState,
} from './edit-state';
export {
  canEdit,
  changeBlocker,
  canSave,
  fileBlocker,
  isDirty,
  problemsOfDraft,
  READ_ONLY_REASON,
  saveBlocker,
  saveStatus,
  textOf,
  writeBlocker,
  type SaveStatusKind,
} from './edit-view';
export {
  SaveConflict,
  SaveLost,
  SaveRefused,
  SessionLost,
  type EditPort,
} from './ports';
export {
  errorsOf,
  joinMessages,
  listedOf,
  notesOf,
  problemsFor,
  type Problem,
  type StageField,
} from './problems';
export { CHECK_DELAY_MS, checkAfterPause } from './run-check';
export { reloadWorkflow, saveDraft } from './run-save';
