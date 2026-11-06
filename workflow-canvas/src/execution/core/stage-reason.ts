// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

// One plain sentence for each reason the contract names, from its list under
// **How a run goes**.
const SENTENCES: Readonly<Record<string, string>> = {
  RESULT_MISSING: 'The final message of the session has no result line.',
  RESULT_INVALID: 'The result line of the session is not valid.',
  RESULT_FAILURE: 'The agent reported that it could not do the work.',
  SESSION_FAILED:
    'The session could not start, its agent was not found, or it ended with an error.',
  TIMEOUT: 'The stage, or one of its checks, ran out of time.',
  OUTPUT_MISSING: 'A file that the stage must leave behind does not exist.',
  OUTPUT_UNCHANGED:
    'A file that the stage must leave behind was not created or changed by the stage.',
  CHECK_FAILED: 'A check that the stage must pass failed.',
};

/**
 * The sentence that says what a reason code means, or `undefined` for a code
 * this page does not know: a later release may add reasons, and the page then
 * shows the code as it is.
 */
export function reasonSentence(code: string): string | undefined {
  return Object.hasOwn(SENTENCES, code) ? SENTENCES[code] : undefined;
}

/** The stage that stopped the run, with its reason, or `undefined`. */
export function blockedStageOf(
  run: RunView | undefined,
): { name: string; reason: string } | undefined {
  const stage = run?.stages.find((candidate) => candidate.status === 'blocked');
  return stage?.reason === undefined
    ? undefined
    : { name: stage.name, reason: stage.reason };
}
