// SPDX-License-Identifier: Apache-2.0
import type {
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
  WorkflowView,
} from '../../api/types';
import { draftOf, type Draft } from './draft';
import { checkOf, type Check } from './problems';

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

/** What the Designer edits: the saved workflow, and the draft beside it. */
export interface EditState {
  /** The workflow as the server has it. */
  saved: EditableDocument;
  draft: Draft;
  selectedId: string;
  /**
   * Counts the changes of the draft; a check answers for one revision. It
   * only grows, also across `open` and `reloaded`, so an answer meant for an
   * earlier document never fits a later one.
   */
  revision: number;
  /**
   * The latest check. It stays on show while the draft changes, until the
   * check of the new revision answers.
   */
  check: Check;
  save: SaveState;
  /**
   * The text of the draft that the last reload replaced, if it had changes. It
   * stays, so the person can take it away, until the file is loaded again or
   * a save succeeds.
   */
  discarded?: string;
}

/** Something that happened to the editor. */
export type EditEvent =
  | { type: 'open'; document: WorkflowDocument }
  | { type: 'select'; id: string }
  | { type: 'add' }
  | { type: 'rename'; id: string; name: string }
  | { type: 'set-agent'; id: string; agent: string }
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
  const draft = draftOf(document.view.stages);
  return {
    saved: document,
    draft,
    selectedId: draft.stages[0]?.id ?? '',
    revision,
    check: checkOf(revision, document.diagnostics, draft),
    save: { phase: 'idle' },
  };
}
