// SPDX-License-Identifier: Apache-2.0
import {
  formatElapsed,
  progressText,
  type RunProgress,
} from './core/run-progress';
import './run-progress.css';

function share(count: number, total: number): string {
  return `${total === 0 ? 0 : (count / total) * 100}%`;
}

/**
 * One line on how far a run has got: a status sentence, a bar of the passed
 * and blocked stages, and the elapsed time. It is not a live region: the run
 * status is announced once, elsewhere on the page, so a screen reader would
 * otherwise hear each change twice. It reads the sentence and the time when
 * a person moves to them.
 */
export function RunProgressStrip({ progress }: { progress: RunProgress }) {
  return (
    <div className="wf-progress" data-testid="run-progress">
      <p className="wf-progress-summary">{progressText(progress)}</p>
      <div className="wf-progress-bar" aria-hidden="true">
        <span
          className="wf-progress-passed"
          data-testid="run-progress-passed"
          style={{ width: share(progress.passed, progress.total) }}
        />
        {progress.blocked && (
          <span
            className="wf-progress-blocked"
            data-testid="run-progress-blocked"
            style={{ width: share(1, progress.total) }}
          />
        )}
      </div>
      <p className="wf-progress-elapsed">
        Elapsed {formatElapsed(progress.elapsedMs)}
      </p>
    </div>
  );
}
