// SPDX-License-Identifier: Apache-2.0
import type { RunView } from '../../api/types';

/**
 * A trust refusal as the state holds it: the `fix` of the server and the goal
 * of the refused start, so the same run can be asked for again. `refusal`
 * counts the refusals in a row, from 1, so each new refusal has a number of
 * its own. `closed` is set when the dialog of this refusal was closed; a
 * start drops it with the rest of the error.
 */
export interface TrustRefusal {
  fix: string;
  goal: string;
  refusal: number;
  closed?: true;
}

/**
 * Where the page is in the life of a run, as `TrustDialog` reads it. The Run
 * view holds a run in its own state and builds this shape for the dialog.
 */
export type ExecutionState =
  | { phase: 'idle' }
  | {
      phase: 'starting';
      /** The trust refusals in a row before this start, when there were any. */
      trustRefusals?: number;
    }
  | {
      phase: 'following';
      runId: string;
      run: RunView | undefined;
      /** Set when the page joined a run that was already active. */
      joined?: true;
    }
  | {
      phase: 'finished';
      run: RunView;
      /** Set when the page joined a run that was already active. */
      joined?: true;
    }
  | {
      phase: 'error';
      message: string;
      started: boolean;
      /** Set when the start got no clear answer, so the run may be going. */
      maybeStarted?: true;
      /** The run that was being followed, when the failure came after it began. */
      runId?: string;
      /** Set when the start was refused because the workflow is not trusted. */
      trust?: TrustRefusal;
    };
