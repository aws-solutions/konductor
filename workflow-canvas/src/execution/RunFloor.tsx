// SPDX-License-Identifier: Apache-2.0
import { useId, useState } from 'react';
import { RunHistoryList } from './RunHistoryList';
import { RunProgressStrip } from './RunProgressStrip';
import { StageDetail } from './StageDetail';
import { shownStage } from './core/run-floor';
import type { FollowedRun, FollowedStage } from './core/run-follow';
import type { RunSummaryRow } from './core/run-history';
import type { RunProgress } from './core/run-progress';
import { stageStateWord, type ReasonSentence } from './core/stage-detail';
import './run-floor.css';

function StageButton({
  stage,
  current,
  runFinished,
  onPick,
}: {
  stage: FollowedStage;
  current: boolean;
  runFinished: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="wf-floor-stage"
        aria-current={current ? 'true' : undefined}
        onClick={onPick}
      >
        <span className="wf-floor-stage-name">{stage.name}</span>
        <span className="wf-floor-stage-state">
          {stageStateWord(stage.status, runFinished)}
        </span>
      </button>
    </li>
  );
}

function Stages({
  run,
  reasonSentence,
}: {
  run: FollowedRun;
  reasonSentence: ReasonSentence;
}) {
  const listId = useId();
  const [picked, setPicked] = useState<string>();
  const runFinished = run.outcome !== undefined;
  const shown = shownStage(run, picked);
  if (shown === undefined) {
    return <p className="wf-floor-note">This run has no stages.</p>;
  }
  return (
    <div className="wf-floor-stages">
      <section aria-labelledby={listId}>
        <h2 className="wf-floor-title" id={listId}>
          Stages
        </h2>
        <ol className="wf-floor-list" role="list">
          {run.stages.map((stage) => (
            <StageButton
              key={stage.name}
              stage={stage}
              current={stage.name === shown.name}
              runFinished={runFinished}
              onPick={() => setPicked(stage.name)}
            />
          ))}
        </ol>
      </section>
      <StageDetail
        key={shown.name}
        stage={shown}
        runFinished={runFinished}
        reasonSentence={reasonSentence}
      />
    </div>
  );
}

/**
 * The run as it is followed: how far it has got across the top, its stages
 * with the detail and console of the one picked, and the past runs at the
 * side. It takes what it shows and fetches nothing. Each stage is a button
 * in the Tab order; picking one keeps focus on it, and the detail of that
 * stage comes next in the Tab order. Runs of one workflow share stage
 * names, so the pick is dropped whenever `runId` changes.
 */
export function RunFloor({
  run,
  runId,
  progress,
  history,
  reasonSentence,
}: {
  /** The run as `applyRunEvents` keeps it, or `undefined` before there is one. */
  run: FollowedRun | undefined;
  /**
   * The id of the run `run` holds the events of. The picked stage is dropped
   * when it changes, so a pick of one run does not carry into the next.
   */
  runId: string | undefined;
  /** How far the run has got, from `runProgress`. */
  progress: RunProgress | undefined;
  /** The past runs, as `GET /api/runs` lists them. */
  history: readonly RunSummaryRow[];
  reasonSentence: ReasonSentence;
}) {
  return (
    <div className="wf-floor">
      <div className="wf-floor-main">
        {progress && <RunProgressStrip progress={progress} />}
        {run ? (
          <Stages key={runId} run={run} reasonSentence={reasonSentence} />
        ) : (
          <p className="wf-floor-note">No run yet.</p>
        )}
      </div>
      <div className="wf-floor-side">
        <RunHistoryList runs={history} />
      </div>
    </div>
  );
}
