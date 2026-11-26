// SPDX-License-Identifier: Apache-2.0
import { useId, useState } from 'react';
import { CheckState } from './CheckState';
import { RunHistoryList } from './RunHistoryList';
import { RunProgressStrip } from './RunProgressStrip';
import { StageDetail } from './StageDetail';
import { shownStage } from './core/run-floor';
import type { FollowedRun, FollowedStage } from './core/run-follow';
import type { RunSummaryRow } from './core/run-history';
import type { RunProgress } from './core/run-progress';
import { stageCheckRows, type CheckRow } from './core/run-checks';
import { stageStateWord, type ReasonSentence } from './core/stage-detail';
import './run-floor.css';

function StageButton({
  stage,
  current,
  runFinished,
  checks,
  onPick,
}: {
  stage: FollowedStage;
  current: boolean;
  runFinished: boolean;
  /** The checks this stage waits for, in the order of the file. */
  checks: readonly CheckRow[];
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
        {checks.length > 0 && (
          <span className="wf-floor-stage-checks">
            {checks.map((check) => (
              <CheckState key={check.id} check={check} inStage />
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

function Stages({
  run,
  ended,
  checks,
  reasonSentence,
}: {
  run: FollowedRun;
  ended: boolean;
  checks: readonly CheckRow[];
  reasonSentence: ReasonSentence;
}) {
  const listId = useId();
  const [picked, setPicked] = useState<string>();
  const runFinished = run.outcome !== undefined || ended;
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
              checks={stageCheckRows(stage.name, checks)}
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

/** A run whose checks the caller does not pass, as one object for every render. */
const NO_CHECKS: readonly CheckRow[] = [];

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
  ended = false,
  checks = NO_CHECKS,
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
  /**
   * The run is over although no `run_finished` event said how it ended, as
   * the follower can report. Nothing is then shown as still at work.
   */
  ended?: boolean;
  /**
   * The checks the run reports, so each stage shows the ones its `done_when`
   * waits for. A view with none shows no mark.
   */
  checks?: readonly CheckRow[];
  reasonSentence: ReasonSentence;
}) {
  return (
    <div className="wf-floor">
      <div className="wf-floor-main">
        {progress && <RunProgressStrip progress={progress} />}
        {run ? (
          <Stages
            key={runId}
            run={run}
            ended={ended}
            checks={checks}
            reasonSentence={reasonSentence}
          />
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
