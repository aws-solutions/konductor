// SPDX-License-Identifier: Apache-2.0
import { messageOf } from '../../api/message-of';
import type { EditEvent } from './edit-state';
import { isEditable } from './edit-state';
import { SaveConflict, SaveLost, SaveRefused, type EditPort } from './ports';

const UNKNOWN_FAILURE = 'The workflow was not saved.';

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

// After a save whose answer was lost, the file tells whether it was written:
// if it holds the text that was sent, the save worked.
async function settleLost(
  edits: EditPort,
  text: string,
  lost: SaveLost,
): Promise<EditEvent> {
  try {
    const document = await edits.reload();
    if (isEditable(document) && document.text === text) {
      const { hash, view, diagnostics } = document;
      return { type: 'saved', text, result: { hash, view, diagnostics } };
    }
  } catch {
    // The file cannot be read either; the failure of the save stands.
  }
  return { type: 'failed', message: lost.message };
}

/**
 * Writes the text and tells `emit` how it went: saved, a conflict because the
 * file changed, a refusal with the findings of the check, or a failure with a
 * sentence. When the answer of the save was lost, it reads the file to see
 * whether the text was written. It never rejects, and one event always
 * follows.
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
    } else if (error instanceof SaveLost) {
      emit(await settleLost(edits, text, error));
    } else {
      emit({ type: 'failed', message: messageOf(error, UNKNOWN_FAILURE) });
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
    emit({ type: 'reload-failed', message: messageOf(error, UNKNOWN_FAILURE) });
  }
}
