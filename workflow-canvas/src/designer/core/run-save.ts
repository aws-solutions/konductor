// SPDX-License-Identifier: Apache-2.0
import { messageOf } from '../../api/message-of';
import type { SaveResult } from '../../api/types';
import type { EditEvent } from './edit-state';
import { isEditable } from './edit-state';
import { hasErrors } from './problems';
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

const MAY_HAVE_BEEN_WRITTEN =
  'The save may or may not have gone through. Load the file again to see what it holds.';

// The document if the file holds exactly the text that was sent, so a save
// that is not known to have worked did: the file tells.
async function fileHolding(
  edits: EditPort,
  text: string,
): Promise<SaveResult | undefined | 'unread'> {
  try {
    const document = await edits.reload();
    if (!isEditable(document) || document.text !== text) return undefined;
    const { hash, view, diagnostics } = document;
    return { hash, view, diagnostics };
  } catch {
    return 'unread';
  }
}

// After a save whose answer was lost, the file tells whether it was written.
// If it holds the text that was sent, the save worked. If it cannot be read,
// the outcome is not known, and the page says so.
async function settleLost(
  edits: EditPort,
  text: string,
  lost: SaveLost,
): Promise<EditEvent> {
  const found = await fileHolding(edits, text);
  if (found === 'unread') {
    return {
      type: 'failed',
      message: `${lost.message} ${MAY_HAVE_BEEN_WRITTEN}`,
      uncertain: true,
    };
  }
  return found
    ? { type: 'saved', text, result: found }
    : { type: 'failed', message: lost.message };
}

// A conflict whose file holds the text that was sent is the page's own write
// that landed earlier, such as one whose answer was lost: the save worked. A
// deleted file (no `currentHash`) holds nothing to compare.
async function settleConflict(
  edits: EditPort,
  text: string,
  conflict: SaveConflict,
): Promise<EditEvent> {
  const found =
    conflict.currentHash === undefined
      ? undefined
      : await fileHolding(edits, text);
  return found && found !== 'unread'
    ? { type: 'saved', text, result: found }
    : { type: 'conflict' };
}

// A refusal with nothing to show would leave the page silent, so it is told as
// a failure with the sentence of the server.
function refusal(error: SaveRefused, revision: number): EditEvent {
  return hasErrors(error.diagnostics)
    ? { type: 'refused', revision, diagnostics: error.diagnostics }
    : { type: 'failed', message: error.message };
}

/**
 * Writes the text and tells `emit` how it went: saved, a conflict because the
 * file changed, a refusal with the findings of the check, or a failure with a
 * sentence. When the answer of the save was lost, or the file changed to the
 * text that was sent, it reads the file to see whether the text was written.
 * It never rejects, and one event always follows.
 */
export async function saveDraft(request: SaveRequest): Promise<void> {
  const { edits, text, baseHash, revision, emit } = request;
  try {
    emit({ type: 'saved', text, result: await edits.save(text, baseHash) });
  } catch (error) {
    if (error instanceof SaveConflict) {
      emit(await settleConflict(edits, text, error));
    } else if (error instanceof SaveRefused) {
      emit(refusal(error, revision));
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
