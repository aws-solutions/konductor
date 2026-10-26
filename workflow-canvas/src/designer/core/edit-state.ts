// SPDX-License-Identifier: Apache-2.0
import type {
  DiagnosticView,
  SaveResult,
  WorkflowDocument,
  WorkflowView,
} from '../../api/types';
import { draftOf, type Draft } from './draft';

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
  | { phase: 'failed'; message: string };

/** What the Designer edits: the saved workflow, and the draft beside it. */
export interface EditState {
  /** The workflow as the server has it. */
  saved: EditableDocument;
  draft: Draft;
  selectedId: string;
  /** Counts the changes of the draft; a check answers for one revision. */
  revision: number;
  /** The latest check, and the revision of the draft that it checked. */
  check: { revision: number; diagnostics: readonly DiagnosticView[] };
  save: SaveState;
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
  | { type: 'failed'; message: string }
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

/** The state for a document just loaded, or `undefined` if it has no file. */
export function openDocument(
  document: WorkflowDocument,
): EditState | undefined {
  if (!isEditable(document)) return undefined;
  const draft = draftOf(document.view.stages);
  return {
    saved: document,
    draft,
    selectedId: draft.stages[0]?.id ?? '',
    revision: 0,
    check: { revision: 0, diagnostics: document.diagnostics },
    save: { phase: 'idle' },
  };
}
