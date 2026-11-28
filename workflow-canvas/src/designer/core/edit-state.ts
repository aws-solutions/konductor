// SPDX-License-Identifier: Apache-2.0
import type {
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
  WorkflowView,
} from '../../api/types';
import {
  draftOf,
  idsOf,
  sourceParamIds,
  type Draft,
  type DraftCheck,
  type SubmittedOutputRows,
} from './draft';
import { checkOf, type Check } from './problems';
import { savedPrompts } from './saved-prompts';

/** A workflow that has a file, so it can be edited and saved. */
export type EditableDocument = WorkflowDocument & {
  text: string;
  hash: string;
  view: WorkflowView;
};

/** Where saving is. `conflict` waits for a reload. */
export type SaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  | { phase: 'reloading' }
  | { phase: 'reloaded' }
  | { phase: 'conflict'; problem?: string }
  | {
      phase: 'failed';
      message: string;
      /** The save may or may not have been written: the answer was lost. */
      uncertain?: true;
      /** The server no longer knows the session; the failure is no save's. */
      sessionLost?: true;
    };

/**
 * What a save was asked to write, recorded when it starts. The answer is
 * applied to this, not to the state as it is when the answer arrives, so an
 * edit made while the save ran is not taken for the one that was sent.
 */
export interface Submission {
  /** Whether the text came from the form draft or from a raw edit. */
  kind: 'form' | 'raw';
  text: string;
  /** The revision the text was written from. */
  revision: number;
}

/** What the Designer edits: the saved workflow, and the draft beside it. */
export interface EditState {
  /** The workflow as the server has it. */
  saved: EditableDocument;
  draft: Draft;
  /**
   * The id of the draft stage that each stage of `saved.view` is, in order,
   * so a save knows which stage of the file a draft stage was and edits its
   * values in place. A stage that was deleted from the draft keeps its id.
   */
  bases: readonly string[];
  /** The id of each parameter declaration in `saved.view`, in order. */
  paramBases: readonly string[];
  /** The ids of the draft stages in the save that is going on, in order. */
  sent?: readonly string[];
  /** Output row ids submitted for each stage, in submitted stage order. */
  sentOutputs?: readonly SubmittedOutputRows[];
  /** Check row keys submitted in source order. */
  sentChecks?: readonly string[];
  /** The ids of the params in the save that is going on, in order. */
  sentParams?: readonly string[];
  selectedId: string;
  /**
   * Counts the changes of the draft; a check answers for one revision. A
   * revision is never used twice in an `EditSlot`, also across `open` and
   * `reloaded`, so an answer meant for an earlier document never fits a later
   * one.
   */
  revision: number;
  /**
   * The latest check. It stays on show while the draft changes, until the
   * check of the new revision answers.
   */
  check: Check;
  save: SaveState;
  /**
   * The text of a raw edit: the whole file as it was typed over. The stages
   * of `draft` still describe `saved.text`, so they are stale while this is
   * set and no form edit is taken; a save writes this text as it stands, and
   * the state opens again from what the server parsed.
   */
  raw?: string;
  /** What the save that is going on was asked to write. */
  submitted?: Submission;
  /**
   * The text of the draft that the last reload replaced, if it had changes. It
   * stays, so the person can take it away, until the file is loaded again or
   * a save succeeds.
   */
  discarded?: string;
}

/**
 * What the editor holds: the state, if there is a workflow to edit, and the
 * highest revision handed out so far, which outlives the state.
 */
export interface EditSlot {
  current: EditState | undefined;
  lastRevision: number;
}

export const EMPTY_SLOT: EditSlot = { current: undefined, lastRevision: -1 };

/** Something that happened to the editor. */
export type EditEvent =
  | { type: 'open'; document: WorkflowDocument }
  | { type: 'select'; id: string }
  | { type: 'add' }
  | { type: 'insert'; index: number; agent: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'set-agent'; id: string; agent: string }
  | { type: 'set-prompt'; id: string; prompt: string }
  | {
      type: 'set-output';
      stageId: string;
      outputId: string;
      output: { name: string; path: string };
    }
  | { type: 'add-output'; stageId: string }
  | { type: 'remove-output'; stageId: string; outputId: string }
  | {
      type: 'set-check';
      key: string;
      check: Omit<DraftCheck, 'key' | 'sourceIndex'>;
    }
  | { type: 'add-check' }
  | { type: 'remove-check'; key: string }
  | { type: 'set-done-when'; stageId: string; keys: readonly string[] }
  | {
      type: 'set-param';
      id: string;
      change: Partial<
        Pick<
          Draft['params'][number],
          'name' | 'description' | 'default' | 'required'
        >
      >;
    }
  | { type: 'add-param' }
  | { type: 'remove-param'; id: string }
  /** The whole text was typed over, so the stages of the draft are stale. */
  | { type: 'set-text'; text: string }
  | { type: 'remove'; id: string }
  | { type: 'checked'; revision: number; diagnostics: DiagnosticView[] }
  | { type: 'save' }
  | { type: 'saved'; text: string; result: SaveResult }
  | { type: 'conflict' }
  | {
      type: 'refused';
      revision: number;
      diagnostics: readonly DiagnosticView[];
    }
  | { type: 'failed'; message: string; uncertain?: true }
  /** A check was refused because the server no longer knows the session. */
  | { type: 'session-lost'; message: string }
  | { type: 'reload' }
  | { type: 'reloaded'; document: WorkflowDocument }
  | { type: 'reload-failed'; message: string };

/** Whether the document has a file that parses, which is what can be edited. */
export function isEditable(
  document: WorkflowDocument,
): document is EditableDocument {
  return (
    document.text !== null && document.hash !== null && document.view !== null
  );
}

/**
 * The state for a document just loaded, or `undefined` if it has no file. It
 * starts at `revision`, which must be above any revision used before.
 */
export function openDocument(
  document: WorkflowDocument,
  revision = 0,
): EditState | undefined {
  if (!isEditable(document)) return undefined;
  const prompts = savedPrompts(document)?.map((spot) => spot.text);
  const draft = draftOf(
    document.view.stages,
    prompts,
    document.view.params,
    document.view.intent.accept,
  );
  return {
    saved: document,
    draft,
    bases: idsOf(draft),
    paramBases: sourceParamIds(draft),
    selectedId: draft.stages[0]?.id ?? '',
    revision,
    check: checkOf(revision, document.diagnostics, draft),
    save: { phase: 'idle' },
  };
}
