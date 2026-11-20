// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import type { Scheduler } from '../execution/core/ports';
import { startFollowing, type FollowedRun } from '../execution/core/run-follow';
import { followRunEvents, type ReadEvents } from './follow-run-events';

/**
 * Where following a run is. `session_lost` means the server answered 401:
 * it no longer knows the session, so the caller drops it, as for any other
 * call of the session.
 */
export type FollowStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'following' }
  | { readonly kind: 'finished' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'session_lost'; readonly message: string };

/** What `useFollowRun` gives: the run as read so far, and the status. */
export interface FollowRunState {
  /** Undefined while there is no run to follow. */
  readonly run?: FollowedRun;
  readonly status: FollowStatus;
}

/** What `useFollowRun` needs. */
export interface FollowRunInput {
  /**
   * The reads of the session, which the module that holds the session token
   * builds, so this hook never sees the token. A new one is a new session,
   * and following starts again through it. `undefined` without a session.
   */
  readonly readEvents: ReadEvents | undefined;
  /** Read when following starts, so a new object each render restarts nothing. */
  readonly scheduler: Scheduler;
  /** The time now, in milliseconds. Read like `scheduler`. */
  readonly now: () => number;
  readonly runId: string | undefined;
  /** The stages of the workflow in run order. */
  readonly order: readonly string[];
}

const IDLE: FollowRunState = { status: { kind: 'idle' } };
const FOLLOWING: FollowStatus = { kind: 'following' };

// What a state was read for, so a state of an earlier follower is not shown.
interface Source {
  readonly readEvents: ReadEvents;
  readonly runId: string;
  readonly orderKey: string;
}

interface Followed extends FollowRunState {
  readonly source: Source;
}

// Stage names cannot hold a line break, so this tells two orders apart.
const orderKeyOf = (order: readonly string[]) => order.join('\n');

function sameSource(a: Source, b: Source): boolean {
  return (
    a.readEvents === b.readEvents &&
    a.runId === b.runId &&
    a.orderKey === b.orderKey
  );
}

function endStatus(
  end: Awaited<ReturnType<typeof followRunEvents>>,
): FollowStatus | undefined {
  switch (end.kind) {
    case 'finished':
      return { kind: 'finished' };
    case 'failed':
    case 'session_lost':
      return { kind: end.kind, message: end.message };
    case 'aborted':
      return undefined;
  }
}

/**
 * Follows the events of the run `runId` with `followRunEvents` and gives the
 * run as read so far. A new run id, session reader or stage order starts
 * again from the first event; the follower before it is aborted, and the
 * next one starts only once it has ended, so two never run at once.
 * Unmounting aborts it, and no update comes after.
 */
export function useFollowRun(input: FollowRunInput): FollowRunState {
  const { readEvents, runId, order } = input;
  const orderKey = orderKeyOf(order);
  const [followed, setFollowed] = useState<Followed | undefined>();
  const latest = useRef(input);
  const previous = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (readEvents === undefined || runId === undefined) return;
    const source: Source = { readEvents, runId, orderKey };
    const controller = new AbortController();
    const { signal } = controller;
    const update = (state: FollowRunState) => {
      if (!signal.aborted) setFollowed({ source, ...state });
    };
    const follow = async () => {
      if (signal.aborted) return;
      const { scheduler, now, order: stages } = latest.current;
      const end = await followRunEvents({
        ports: { readEvents, scheduler, now },
        runId,
        from: startFollowing(stages),
        onRun: (run) => update({ run, status: FOLLOWING }),
        signal,
      });
      const status = endStatus(end);
      if (status) update({ run: end.run, status });
    };
    previous.current = previous.current.then(follow).catch(() => undefined);
    return () => controller.abort();
  }, [readEvents, runId, orderKey]);

  if (readEvents === undefined || runId === undefined) return IDLE;
  if (
    followed &&
    sameSource(followed.source, { readEvents, runId, orderKey })
  ) {
    return followed;
  }
  return { run: startFollowing(order), status: FOLLOWING };
}
