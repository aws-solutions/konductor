// SPDX-License-Identifier: Apache-2.0
import { liveStatusText, type ExecutionState } from './core';
import { runErrorSentence } from './run-error';
import './announcements.css';

/**
 * The two live regions of the run, for a screen reader: where the run is, and
 * why it failed. The status says nothing on an error, or at rest before a
 * workflow has loaded (`liveStatusText`). The page keeps them mounted outside
 * the tabs, so a change is announced while the Designer tab is open too, when
 * the Execution tab and its visible copy of these sentences are not on the
 * page.
 */
export function RunAnnouncements({
  state,
  loaded,
}: {
  state: ExecutionState;
  /** Whether a workflow is on the page, so a run can be started. */
  loaded: boolean;
}) {
  return (
    <>
      <div
        role="status"
        className="wf-visually-hidden"
        data-testid="run-live-status"
      >
        {liveStatusText(state, loaded)}
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
