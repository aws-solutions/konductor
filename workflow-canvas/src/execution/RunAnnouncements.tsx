// SPDX-License-Identifier: Apache-2.0
import { statusText, type ExecutionState } from './core';
import { runErrorSentence } from './run-error';
import './announcements.css';

/**
 * The two live regions of the run, for a screen reader: where the run is, and
 * why it failed. The page keeps them mounted outside the tabs, so a change is
 * announced while the Designer tab is open too, when the Execution tab and its
 * visible copy of these sentences are not on the page.
 */
export function RunAnnouncements({ state }: { state: ExecutionState }) {
  return (
    <>
      <div
        role="status"
        className="wf-visually-hidden"
        data-testid="run-live-status"
      >
        {statusText(state)}
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
