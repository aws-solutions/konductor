// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import {
  historyRows,
  runStateWord,
  startedText,
  type RunSummaryRow,
} from './core/run-history';
import './announcements.css';
import './run-history.css';

function Goal({ run }: { run: RunSummaryRow }) {
  if (run.goal === '') {
    return <p className="wf-history-goal wf-history-muted">No goal</p>;
  }
  return (
    <p className="wf-history-goal">
      <span className="wf-visually-hidden">Goal: </span>
      {run.goal}
      {run.goal_truncated && (
        <>
          <span aria-hidden="true">…</span>
          <span className="wf-visually-hidden"> (cut short)</span>
        </>
      )}
    </p>
  );
}

function Row({ run }: { run: RunSummaryRow }) {
  return (
    <li className="wf-history-row" data-testid="run-history-row">
      <div className="wf-history-head">
        <span className={`wf-history-state wf-history-${run.status}`}>
          {runStateWord(run.status)}
        </span>
        <code className="wf-history-id">{run.run_id}</code>
        <time className="wf-history-muted" dateTime={run.started_at}>
          {startedText(run.started_at)}
        </time>
      </div>
      <Goal run={run} />
    </li>
  );
}

/**
 * The past runs of the workflow, newest first: the state, id, start time and
 * goal of each. A goal the server cut ends in a mark, and an empty goal says
 * so. The goal is text, never markup.
 */
export function RunHistoryList({
  runs,
}: {
  /** The runs as `GET /api/runs` lists them. */
  runs: readonly RunSummaryRow[];
}) {
  const headingId = useId();
  const rows = historyRows(runs);
  return (
    <section className="wf-history" aria-labelledby={headingId}>
      <h3 className="wf-history-title" id={headingId}>
        Past runs
      </h3>
      {rows.length === 0 ? (
        <p className="wf-history-empty wf-history-muted">No runs yet.</p>
      ) : (
        // Safari drops the list role of a list with no markers unless it is
        // given again.
        <ol className="wf-history-list" role="list" aria-labelledby={headingId}>
          {rows.map((run) => (
            <Row key={run.run_id} run={run} />
          ))}
        </ol>
      )}
    </section>
  );
}
