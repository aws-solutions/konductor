// SPDX-License-Identifier: Apache-2.0
import type { FollowedStage } from './run-follow';

/**
 * The sentence for a reason code of a blocked stage, or `undefined` for a
 * code it does not know.
 */
export type ReasonSentence = (code: string) => string | undefined;

/**
 * The word for where a stage is. A pending stage of a finished run will not
 * start, so it is not run rather than queued, as on the canvas.
 */
export function stageStateWord(
  status: FollowedStage['status'],
  runFinished: boolean,
): string {
  switch (status) {
    case 'pending':
      return runFinished ? 'Not run' : 'Queued';
    case 'running':
      return 'Running';
    case 'passed':
      return 'Passed';
    case 'blocked':
      return 'Blocked';
  }
}

/**
 * Why a blocked stage stopped the run: the sentence for its reason, or the
 * code itself when the sentence is not known, as a later release may add
 * codes. `undefined` for a stage that is not blocked.
 */
export function blockedText(
  stage: FollowedStage,
  reasonSentence: ReasonSentence,
): string | undefined {
  if (stage.status !== 'blocked') return undefined;
  if (stage.reason === undefined) return 'The stage stopped the run.';
  return (
    reasonSentence(stage.reason) ??
    `The stage stopped the run with the reason ${stage.reason}.`
  );
}
