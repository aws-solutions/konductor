// SPDX-License-Identifier: Apache-2.0
import type { EditableDocument } from './edit-state';
import { promptSpots, type PromptSpot } from './prompt-spots';

// Reading the file takes a few milliseconds for a large one, and the answer
// depends only on the document, which a load or a save replaces and never
// mutates, so it is kept for each document.
const kept = new WeakMap<EditableDocument, PromptSpot[] | undefined>();

/**
 * The prompt of each stage of the saved text, in the order of `view.stages`,
 * or `undefined` when the text does not read as a list of the stages of the
 * view.
 */
export function savedPrompts(
  saved: EditableDocument,
): PromptSpot[] | undefined {
  if (kept.has(saved)) return kept.get(saved);
  const spots = promptSpots(saved.text);
  const found = spots?.length === saved.view.stages.length ? spots : undefined;
  kept.set(saved, found);
  return found;
}
