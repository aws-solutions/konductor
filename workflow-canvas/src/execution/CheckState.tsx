// SPDX-License-Identifier: Apache-2.0
import { checkStateWord, type CheckRow } from './core/run-checks';
import './run-checks.css';

/**
 * The state of one check as a small mark: the word the run reports, in the
 * success tone once the run has verified it and in the muted tone until then.
 * The word carries the state on its own, so the colour is not the only thing
 * that says it. Beside a stage the mark names the check too, because the
 * stage row does not.
 */
export function CheckState({
  check,
  inStage = false,
}: {
  readonly check: CheckRow;
  /** The mark sits in a stage row, where the check's id is not shown. */
  readonly inStage?: boolean;
}) {
  const word = checkStateWord(check.state);
  return (
    <span
      className={`wf-check-state${check.verified ? ' is-verified' : ''}`}
      data-testid={`${inStage ? 'stage-check' : 'check-state'}-${check.id}`}
    >
      {inStage ? `${check.id}: ${word}` : word}
    </span>
  );
}
