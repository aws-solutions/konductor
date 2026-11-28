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
  MAX_PROMPT_CHARS,
  MAX_STAGES,
  insertStage,
  nextStageName,
  type Draft,
  type DraftCheck,
  type DraftCheckReference,
  type DraftOutput,
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
  type Submission,
} from './edit-state';
export {
  canEdit,
  changeBlocker,
  checksBlocker,
  dataUnlinkBlocker,
  doneWhenBlocker,
  canSave,
  dataLinkBlocker,
  dataLinkStructureBlocker,
  fileBlocker,
  formTextOf,
  insertionBlocker,
  isDirty,
  outputsBlocker,
  paramsBlocker,
  problemsOfDraft,
  promptFieldOf,
  RAW_EDIT_REASON,
  RAW_SAVE_REASON,
  SAVING_REASON,
  rawTextOf,
  READ_ONLY_REASON,
  saveBlocker,
  savingRawText,
  saveStatus,
  textBlocker,
  textOf,
  writeBlocker,
  type PromptField,
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
