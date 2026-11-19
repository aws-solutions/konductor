// SPDX-License-Identifier: Apache-2.0
import type { FollowedRun } from './run-follow';

/** The time now, in milliseconds since the epoch. */
export type Clock = () => number;

/**
 * When the run started and, once it has, ended, in milliseconds since the
 * epoch: the `started_at` and `finished_at` of the run, parsed by the caller.
 */
export interface RunTiming {
  readonly startedAt: number;
  readonly finishedAt?: number;
}

/** How far a run has got, for the progress strip. */
export interface RunProgress {
  readonly passed: number;
  readonly total: number;
  /** The stage at work, if one is. */
  readonly running?: string;
  /** The stage that stopped the run, if one did. */
  readonly blocked?: { readonly name: string; readonly reason?: string };
  /** Set once the run has ended. */
  readonly outcome?: 'passed' | 'halted';
  readonly elapsedMs: number;
}

/**
 * Where `run` is. The elapsed time runs from the start to the end of the run,
 * or to `clock()` while it goes on, and is never below zero. The end is the
 * `at` of the `run_finished` event once it is read, so a page that follows
 * only events stops the clock too, or else `timing.finishedAt`.
 */
export function runProgress(
  run: FollowedRun,
  timing: RunTiming,
  clock: Clock,
): RunProgress {
  const running = run.stages.find((stage) => stage.status === 'running');
  const blocked = run.stages.find((stage) => stage.status === 'blocked');
  const end = run.finishedAt ?? timing.finishedAt ?? clock();
  return {
    passed: run.stages.filter((stage) => stage.status === 'passed').length,
    total: run.stages.length,
    ...(running ? { running: running.name } : {}),
    ...(blocked
      ? {
          blocked: {
            name: blocked.name,
            ...(blocked.reason === undefined ? {} : { reason: blocked.reason }),
          },
        }
      : {}),
    ...(run.outcome ? { outcome: run.outcome.status } : {}),
    elapsedMs: Math.max(0, end - timing.startedAt),
  };
}

/** The sentence that says where the run is, without the elapsed time. */
export function progressText(progress: RunProgress): string {
  const count = `${progress.passed} of ${progress.total} stages passed.`;
  if (progress.outcome === 'passed') return `Run passed. ${count}`;
  if (progress.outcome === 'halted') {
    const at = progress.blocked ? ` at ${progress.blocked.name}` : '';
    return `Run halted${at}. ${count}`;
  }
  if (progress.blocked) return `Blocked at ${progress.blocked.name}. ${count}`;
  if (progress.running) return `Running ${progress.running}. ${count}`;
  return `Waiting for the next stage. ${count}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** An elapsed time as `m:ss`, or `h:mm:ss` from an hour on. */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = twoDigits(seconds % 60);
  return hours > 0
    ? `${hours}:${twoDigits(minutes)}:${rest}`
    : `${minutes}:${rest}`;
}
