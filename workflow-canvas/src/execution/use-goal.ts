// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { LoadResult } from '../workflow/load-workflow';

// The box is one line, so a line break of the default becomes a space, and
// what the person reads is what the run is given.
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * The text of the Goal box: what the person typed, or the `default` of the
 * file's `params.goal` until they type. A file without one leaves the box
 * empty, and Run stays off until a goal is typed. The caller keeps it, so it
 * survives a switch of tab, which unmounts the Execution tab.
 */
export function useGoal(
  result: LoadResult | undefined,
): [goal: string, setGoal: (goal: string) => void] {
  const [typed, setTyped] = useState<string>();
  const fallback = result?.ok
    ? result.workflow.document.view?.params?.goal?.default
    : undefined;
  return [typed ?? oneLine(fallback ?? ''), setTyped];
}
