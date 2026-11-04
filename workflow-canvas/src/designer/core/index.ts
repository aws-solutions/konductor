// SPDX-License-Identifier: Apache-2.0
/**
 * The core of the Designer's editing: the draft of the stages, the text that
 * a save writes, the findings put on a stage, and the state of the editor
 * with its reducer. It does no IO.
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
export { reduce } from './edit-reducer';
export {
  isEditable,
  openDocument,
  type EditableDocument,
  type EditEvent,
  type EditState,
  type SaveState,
} from './edit-state';
export {
  canEdit,
  canSave,
  isDirty,
  problemsOfDraft,
  READ_ONLY_REASON,
  saveBlocker,
  textOf,
} from './edit-view';
export {
  errorsOf,
  joinMessages,
  notesOf,
  problemsFor,
  type Problem,
  type StageField,
} from './problems';
