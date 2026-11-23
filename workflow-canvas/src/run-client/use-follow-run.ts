// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
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

/** What `useFollowRun` gives: the run as read so far, the status, and `retry`. */
export interface FollowRunState {
  /** Undefined while there is no run to follow. */
  readonly run?: FollowedRun;
  readonly status: FollowStatus;
  /**
   * Follows again after `failed`, from the run as read so far, so the next
   * read asks for the events after the last one already in it. It does
   * nothing in any other status: `idle` and `finished` have nothing left to
   * read, `following` is reading already, and `session_lost` needs a new
   * session, which only the caller can get. It also does nothing once the
   * hook has unmounted.
   */
  readonly retry: () => void;
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

const IDLE: FollowStatus = { kind: 'idle' };
const FOLLOWING: FollowStatus = { kind: 'following' };

// What a state was read for, so a state of an earlier follower is not shown.
interface Source {
  readonly readEvents: ReadEvents;
  readonly runId: string;
  readonly orderKey: string;
}

// How far a follower got, without the `retry` the hook adds to it.
interface Reached {
  readonly run?: FollowedRun;
  readonly status: FollowStatus;
}

interface Followed extends Reached {
  readonly source: Source;
}

// The follower of the mounted hook. `resume` follows once more, from the run
// read so far, after the follow before it has ended.
interface Follower {
  readonly source: Source;
  readonly resume: (from: FollowedRun) => void;
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
 * Unmounting aborts it, and no update comes after. Following that gave up
 * ends in `failed`, and only `retry` takes it up again, from the run as read
 * so far and under the same rules.
 */
export function useFollowRun(input: FollowRunInput): FollowRunState {
  const { readEvents, runId, order } = input;
  const orderKey = orderKeyOf(order);
  const [followed, setFollowed] = useState<Followed | undefined>();
  const latest = useRef(input);
  const previous = useRef<Promise<unknown>>(Promise.resolve());
  const follower = useRef<Follower | undefined>(undefined);
  // The last state a follower reached, which `retry` reads without waiting
  // for the render that shows it.
  const reached = useRef<Followed | undefined>(undefined);

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (readEvents === undefined || runId === undefined) return;
    const source: Source = { readEvents, runId, orderKey };
    const controller = new AbortController();
    const { signal } = controller;
    const update = (state: Reached) => {
      if (signal.aborted) return;
      const next: Followed = { source, ...state };
      reached.current = next;
      setFollowed(next);
    };
    const follow = async (from: FollowedRun) => {
      if (signal.aborted) return;
      const { scheduler, now } = latest.current;
      const end = await followRunEvents({
        ports: { readEvents, scheduler, now },
        runId,
        from,
        onRun: (run) => update({ run, status: FOLLOWING }),
        signal,
      });
      const status = endStatus(end);
      if (status) update({ run: end.run, status });
    };
    const queue = (from: FollowedRun) => {
      previous.current = previous.current
        .then(() => follow(from))
        .catch(() => undefined);
    };
    queue(startFollowing(latest.current.order));
    follower.current = {
      source,
      resume: (from) => {
        // The state of the follower that gave up stays until a read brings
        // something, so the status is set here. A new source needs no such
        // update, as it shows `following` from its first render.
        update({ run: from, status: FOLLOWING });
        queue(from);
      },
    };
    return () => {
      follower.current = undefined;
      controller.abort();
    };
  }, [readEvents, runId, orderKey]);

  const retry = useCallback(() => {
    const live = follower.current;
    const state = reached.current;
    if (!live || !state?.run || state.status.kind !== 'failed') return;
    // A state of an earlier source is on screen no longer, so it is not
    // taken up again either; its own follower has already started.
    if (!sameSource(state.source, live.source)) return;
    live.resume(state.run);
  }, []);

  if (readEvents === undefined || runId === undefined) {
    return { status: IDLE, retry };
  }
  if (
    followed &&
    sameSource(followed.source, { readEvents, runId, orderKey })
  ) {
    return { run: followed.run, status: followed.status, retry };
  }
  return { run: startFollowing(order), status: FOLLOWING, retry };
}
