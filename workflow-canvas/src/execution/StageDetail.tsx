// SPDX-License-Identifier: Apache-2.0
import { useId } from 'react';
import { ConsolePane } from './ConsolePane';
import type { FollowedStage } from './core/run-follow';
import {
  blockedText,
  stageStateWord,
  type ReasonSentence,
} from './core/stage-detail';
import './stage-detail.css';

/**
 * One stage of a run: its name, where it is, why it stopped the run when it
 * is blocked, and its console lines.
 */
export function StageDetail({
  stage,
  runFinished,
  reasonSentence,
}: {
  /** The stage as `applyRunEvents` keeps it. */
  stage: FollowedStage;
  /** Whether the run has ended. */
  runFinished: boolean;
  /** Gives the sentence for a reason code, as the run view says it. */
  reasonSentence: ReasonSentence;
}) {
  const headingId = useId();
  const blocked = blockedText(stage, reasonSentence);
  return (
    <section className="wf-stage-detail" aria-labelledby={headingId}>
      <h2 className="wf-stage-detail-title" id={headingId}>
        {stage.name}
      </h2>
      <p className="wf-stage-detail-state">
        State: <strong>{stageStateWord(stage.status, runFinished)}</strong>
      </p>
      {blocked !== undefined && (
        <p className="wf-stage-detail-reason">{blocked}</p>
      )}
      <ConsolePane stage={stage} runFinished={runFinished} />
    </section>
  );
}
