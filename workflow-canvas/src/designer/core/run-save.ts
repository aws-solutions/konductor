// SPDX-License-Identifier: Apache-2.0
import type { EditEvent } from './edit-state';
import { SaveConflict, SaveRefused, type EditPort } from './ports';

const UNKNOWN_FAILURE = 'The workflow was not saved.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : UNKNOWN_FAILURE;
}

/** What `saveDraft` needs: the port, the text, its base and where events go. */
export interface SaveRequest {
  edits: EditPort;
  text: string;
  /** The hash of the file that the text was made from. */
  baseHash: string;
  /** The revision of the draft that the text is written from. */
  revision: number;
  emit: (event: EditEvent) => void;
}

/**
 * Writes the text and tells `emit` how it went: saved, a conflict because the
 * file changed, a refusal with the findings of the check, or a failure with a
 * sentence. It never rejects, and one event always follows.
 */
export async function saveDraft(request: SaveRequest): Promise<void> {
  const { edits, text, baseHash, revision, emit } = request;
  try {
    emit({ type: 'saved', text, result: await edits.save(text, baseHash) });
  } catch (error) {
    if (error instanceof SaveConflict) {
      emit({ type: 'conflict' });
    } else if (error instanceof SaveRefused) {
      emit({ type: 'refused', revision, diagnostics: error.diagnostics });
    } else {
      emit({ type: 'failed', message: messageOf(error) });
    }
  }
}

/**
 * Loads the workflow again and tells `emit`: the new document, or the
 * sentence of the failure. It never rejects.
 */
export async function reloadWorkflow(
  edits: EditPort,
  emit: (event: EditEvent) => void,
): Promise<void> {
  try {
    emit({ type: 'reloaded', document: await edits.reload() });
  } catch (error) {
    emit({ type: 'reload-failed', message: messageOf(error) });
  }
}
