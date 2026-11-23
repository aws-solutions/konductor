// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import { CodeLines } from '../code-pane/CodeLines';
import type { FollowedStage } from './core/run-follow';

// A stage can still print its first line only while it has not ended and
// the run goes on.
function canStillPrint(stage: FollowedStage, runFinished: boolean): boolean {
  return (
    !runFinished && (stage.status === 'pending' || stage.status === 'running')
  );
}

// Why no line is shown. Lines that are gone, because the run ended over a
// minute ago, the server started again or the run-wide cap dropped them, are
// not "yet".
function emptyText(stage: FollowedStage, runFinished: boolean): string {
  return !stage.dropped && canStillPrint(stage, runFinished)
    ? 'No output yet.'
    : 'No live output is available.';
}

/**
 * The console lines of one stage, read-only. The lines are live only: the
 * server drops them a minute after the run ends, and the page saves none,
 * which the pane says.
 */
export function ConsolePane({
  stage,
  runFinished,
}: {
  /** The stage as `applyRunEvents` keeps it, with its lines oldest first. */
  stage: FollowedStage;
  /** Whether the run has ended, so no further line can come. */
  runFinished: boolean;
}) {
  const noteId = useId();
  const { name, console: lines } = stage;
  return (
    <section className="wf-code-pane" aria-label={`Console of ${name}`}>
      <div className="wf-code-pane-head">
        <h3 className="wf-code-pane-title">Console: {name}</h3>
        <p className="wf-code-note" id={noteId}>
          Live only, not saved.
        </p>
      </div>
      {lines.length === 0 ? (
        <p className="wf-code-note">{emptyText(stage, runFinished)}</p>
      ) : (
        <>
          {stage.dropped && (
            <p className="wf-code-note">Earlier lines are not shown.</p>
          )}
          <CodeLines
            key={name}
            lines={lines}
            label={`Console lines of ${name}`}
            describedBy={noteId}
            followEnd
          />
        </>
      )}
    </section>
  );
}
