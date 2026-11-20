// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { startFollowing, type FollowedRun } from '../execution/core/run-follow';
import { followRunEvents, type RunEventsPorts } from './follow-run-events';

/** Where following a run is. */
export type FollowStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'following' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly message: string };

/** What `useFollowRun` gives: the run as read so far, and the status. */
export interface FollowRunState {
  /** Undefined while there is no run to follow. */
  readonly run?: FollowedRun;
  readonly status: FollowStatus;
}

/** What `useFollowRun` needs. */
export interface FollowRunInput {
  /** Read when following starts, so a new object each render restarts nothing. */
  readonly ports: RunEventsPorts;
  readonly token: string | undefined;
  readonly runId: string | undefined;
  /** The stages of the workflow in run order. */
  readonly order: readonly string[];
}

const IDLE: FollowRunState = { status: { kind: 'idle' } };
const FOLLOWING: FollowStatus = { kind: 'following' };

interface Followed extends FollowRunState {
  readonly key: string;
}

// Stage names cannot hold a line break, so this tells two inputs apart.
function keyOf({ token, runId, order }: FollowRunInput): string | undefined {
  if (token === undefined || runId === undefined) return undefined;
  return [token, runId, ...order].join('\n');
}

/**
 * Follows the events of the run `runId` with `followRunEvents` and gives the
 * run as read so far. A new run id, token or stage order starts again from
 * the first event; the follower before it is aborted, and the next one starts
 * only once it has ended, so two never run at once. Unmounting aborts it, and
 * no update comes after.
 */
export function useFollowRun(input: FollowRunInput): FollowRunState {
  const key = keyOf(input);
  const [followed, setFollowed] = useState<Followed | undefined>();
  const latest = useRef(input);
  const previous = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (key === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    const update = (state: FollowRunState) => {
      if (!signal.aborted) setFollowed({ key, ...state });
    };
    const follow = async () => {
      const { ports, token, runId, order } = latest.current;
      if (signal.aborted || token === undefined || runId === undefined) return;
      const end = await followRunEvents({
        ports,
        token,
        runId,
        from: startFollowing(order),
        onRun: (run) => update({ run, status: FOLLOWING }),
        signal,
      });
      if (end.kind === 'finished') {
        update({ run: end.run, status: { kind: 'finished' } });
      } else if (end.kind === 'failed') {
        update({
          run: end.run,
          status: { kind: 'failed', message: end.message },
        });
      }
    };
    previous.current = previous.current.then(follow).catch(() => undefined);
    return () => controller.abort();
  }, [key]);

  if (key === undefined) return IDLE;
  if (followed?.key === key) return followed;
  return { run: startFollowing(input.order), status: FOLLOWING };
}
