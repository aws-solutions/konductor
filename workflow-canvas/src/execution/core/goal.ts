// SPDX-License-Identifier: Apache-2.0

/** The most characters a goal may have; the API refuses a longer one. */
export const GOAL_MAX_LENGTH = 2048;

/**
 * Why the goal cannot be sent, as a sentence for a person, or `undefined`
 * when it can. Length counts characters, not UTF-16 units, as the API does.
 */
export function goalProblem(goal: string): string | undefined {
  if (goal.trim() === '') return 'Enter a goal to run.';
  return [...goal].length > GOAL_MAX_LENGTH
    ? `The goal can have at most ${GOAL_MAX_LENGTH} characters.`
    : undefined;
}
