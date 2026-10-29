// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { LoadResult } from '../workflow/load-workflow';

// The box is one line, so a line break of the outcome becomes a space, and
// what the person reads is what the run is given.
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

/**
 * The text of the Goal box: what the person typed, or the outcome of the
 * intent until they type. The caller keeps it, so it survives a switch of
 * tab, which unmounts the Execution tab.
 */
export function useGoal(
  result: LoadResult | undefined,
): [goal: string, setGoal: (goal: string) => void] {
  const [typed, setTyped] = useState<string>();
  const outcome = result?.ok
    ? result.workflow.document.view?.intent.outcome
    : '';
  return [typed ?? oneLine(outcome ?? ''), setTyped];
}
