// SPDX-License-Identifier: Apache-2.0
import type { FollowedRun, FollowedStage } from './run-follow';

/**
 * The stage whose detail the run floor shows: the one the person picked
 * while the run still has it, else the stage at work, else the one that
 * stopped the run, else the first. `undefined` for a run with no stages.
 */
export function shownStage(
  run: FollowedRun,
  picked: string | undefined,
): FollowedStage | undefined {
  const { stages } = run;
  return (
    stages.find((stage) => stage.name === picked) ??
    stages.find((stage) => stage.status === 'running') ??
    stages.find((stage) => stage.status === 'blocked') ??
    stages[0]
  );
}
