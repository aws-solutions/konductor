// SPDX-License-Identifier: Apache-2.0
import {
  blockedStageOf,
  reasonSentence,
  statusText,
  type ExecutionState,
} from './core';
import { runErrorSentence } from './run-error';
import { plainText } from '../workflow/message-parts';
import './announcements.css';

// The status for the live region. A halted run adds why its stage stopped:
// the sentence of the reason, or the code for one this page does not know,
// as the Execution tab shows them. A stage with no reason adds nothing.
function liveStatus(state: ExecutionState): string {
  if (state.phase === 'error') return '';
  const text = statusText(state);
  if (state.phase !== 'finished') return text;
  const reason = blockedStageOf(state.run)?.reason;
  if (!reason) return text;
  return `${text} ${plainText(reasonSentence(reason) ?? reason)}`;
}

/**
 * The two live regions of the run, for a screen reader: where the run is, and
 * why it failed. The status stays empty on an error, as the alert says it all
 * and the visible line's "See the error below." points at nothing here. A
 * halted run's status ends with the reason of its blocked stage, which the tab
 * shows under the status line. The page keeps them mounted outside the tabs,
 * so a change is announced while the Designer tab is open too, when the
 * Execution tab and its visible copy of these sentences are not on the page.
 */
export function RunAnnouncements({ state }: { state: ExecutionState }) {
  return (
    <>
      <div
        role="status"
        className="wf-visually-hidden"
        data-testid="run-live-status"
      >
        {liveStatus(state)}
      </div>
      <div
        role="alert"
        className="wf-visually-hidden"
        data-testid="run-live-alert"
      >
        {runErrorSentence(state)}
      </div>
    </>
  );
}
