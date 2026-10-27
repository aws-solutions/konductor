// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import type { LoadResult } from '../workflow/load-workflow';

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
  return [typed ?? outcome ?? '', setTyped];
}
