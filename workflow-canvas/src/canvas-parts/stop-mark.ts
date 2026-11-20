// SPDX-License-Identifier: Apache-2.0
import type { StopMarkState } from '../graph/leaf-stages';

const STATE_WORDS: Readonly<Record<StopMarkState, string>> = {
  passed: 'passed',
  blocked: 'blocked',
  'not-reached': 'not reached',
};

/**
 * The accessible name of the stop mark of the leaf stage `stage`. It says
 * the state once the stage's part of the run is over; `undefined`, while the
 * run may still reach the stage or there is no run, names the mark only.
 */
export function stopMarkLabel(
  stage: string,
  state: StopMarkState | undefined,
): string {
  const mark = `The run ends after ${stage}`;
  return state === undefined ? mark : `${mark}: ${STATE_WORDS[state]}`;
}
