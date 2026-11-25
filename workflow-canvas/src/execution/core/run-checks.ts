// SPDX-License-Identifier: Apache-2.0
import type { WorkflowChecks } from '../../api/types';
import type { FollowedRun } from './run-follow';

/**
 * Whether the server has run a check yet, as a run reports it: `verified`
 * when it has, `deferred` when it has not. A state a later version adds is
 * kept as it came and counted as not verified, so a check this page cannot
 * judge never reads as proof.
 */
export type CheckState = 'verified' | 'deferred' | (string & {});

/** The state of each check of a run, by check id, as the run reports them. */
export type CheckStates = Readonly<Record<string, CheckState>>;

/**
 * Reads the state of each check of the run, as `GET /api/runs/{id}` reports
 * them. It must reject when its signal aborts, as `fetch` does.
 */
export type ReadChecks = (
  runId: string,
  signal: AbortSignal,
) => Promise<CheckStates>;

/** The state of a check that no run has reported yet. */
export const DEFERRED = 'deferred';

/** One check as the Run view draws it. */
export interface CheckRow {
  readonly id: string;
  readonly state: CheckState;
  /** Whether the server has run it. */
  readonly verified: boolean;
  /** The stages whose `done_when` names it, in run order. */
  readonly stages: readonly string[];
}

/** Whether the state says the server has run the check. */
export function isVerified(state: CheckState): boolean {
  return state === 'verified';
}

/** The word to show for a check's state, with its first letter capital. */
export function checkStateWord(state: CheckState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/**
 * The checks of the workflow with the state the run reports for each, in the
 * order of the file. A check the run does not name is `deferred`: a run that
 * has not started, or an older server, reports none, and no check is proof
 * until a run says so.
 */
export function checkRows(
  checks: WorkflowChecks | undefined,
  states: CheckStates,
  order: readonly string[],
): readonly CheckRow[] {
  if (!checks) return [];
  return checks.declared.map((check) => {
    const state = Object.hasOwn(states, check.id)
      ? (states[check.id] ?? DEFERRED)
      : DEFERRED;
    return {
      id: check.id,
      state,
      verified: isVerified(state),
      stages: order.filter(
        (stage) =>
          Object.hasOwn(checks.doneWhen, stage) &&
          (checks.doneWhen[stage] ?? []).includes(check.id),
      ),
    };
  });
}

/** The checks that one stage's `done_when` names, in the order of the file. */
export function stageCheckRows(
  stage: string,
  rows: readonly CheckRow[],
): readonly CheckRow[] {
  return rows.filter((row) => row.stages.includes(stage));
}

/**
 * When the states are worth reading again: the run, how many of its stages
 * have passed, and whether it has ended. The server runs a stage's
 * `done_when` checks as that stage passes, so a read per stage that passes
 * catches every change without polling. A run with no id reads nothing.
 */
export function checksRereadKey(
  runId: string | undefined,
  run: FollowedRun | undefined,
  ended: boolean,
): string | undefined {
  if (runId === undefined) return undefined;
  const passed = (run?.stages ?? []).filter(
    (stage) => stage.status === 'passed',
  ).length;
  return `${runId}:${passed}:${ended ? 'ended' : 'going'}`;
}
