// SPDX-License-Identifier: Apache-2.0
import { useRef } from 'react';
import '../execution/announcements.css';
import type { ReasonSentence } from '../execution/core/stage-detail';
import type { RunLifecycle } from '../run-view/run-start';

/**
 * The two live regions of the run: where it is, and why it failed. They sit
 * outside the views, so a change is announced while the Design view is open
 * too.
 */
export function NextRunAnnouncements({
  run,
  reasonSentence,
  announcement = '',
}: {
  run: RunLifecycle;
  reasonSentence: ReasonSentence;
  announcement?: string;
}) {
  const runStatus =
    run.reason === undefined
      ? run.status
      : `${run.status} ${reasonSentence(run.reason) ?? run.reason}`;
  const seen = useRef({
    announcement,
    runStatus,
    latest: announcement === '' ? 'run' : 'page',
  });
  let latest = seen.current.latest;
  if (announcement !== seen.current.announcement) {
    latest = announcement === '' ? 'run' : 'page';
  }
  if (runStatus !== seen.current.runStatus && runStatus !== '') latest = 'run';
  seen.current = { announcement, runStatus, latest };
  const status = latest === 'page' ? announcement : runStatus;
  return (
    <>
      <div
        role="status"
        className="wf-visually-hidden"
        data-testid="run-live-status"
      >
        {status}
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
