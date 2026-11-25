// SPDX-License-Identifier: Apache-2.0
import '../execution/announcements.css';
import type { RunLifecycle } from '../run-view/run-start';

/**
 * The two live regions of the run: where it is, and why it failed. They sit
 * outside the views, so a change is announced while the Design view is open
 * too.
 */
export function NextRunAnnouncements({ run }: { run: RunLifecycle }) {
  return (
    <>
      <div
        role="status"
        className="wf-visually-hidden"
        data-testid="run-live-status"
      >
        {run.status}
      </div>
      <div
        role="alert"
        className="wf-visually-hidden"
        data-testid="run-live-alert"
      >
        {run.error ?? ''}
      </div>
    </>
  );
}
