// SPDX-License-Identifier: Apache-2.0
import type { Clock } from './clock.ts';
import { HARNESS } from './contract.ts';
import type { Run, StageStatus } from './model.ts';

/** How long each simulated stage takes. */
export const DEFAULT_STAGE_MS = 3000;

interface StartedRun {
  runId: string;
  workflow: string;
  startedAt: number;
  order: string[];
}

export interface RunSimulatorOptions {
  clock: Clock;
  /** Five characters from `a-z0-9`, for the end of a run id. */
  suffix: () => string;
  stageMs?: number;
}

/**
 * Fakes runs without running anything: each read works out the state from the
 * clock, with stages of `stageMs` that all pass.
 */
export class RunSimulator {
  private readonly clock: Clock;
  private readonly suffix: () => string;
  private readonly stageMs: number;
  private readonly runs = new Map<string, StartedRun>();
  private latest: StartedRun | undefined;

  constructor(options: RunSimulatorOptions) {
    this.clock = options.clock;
    this.suffix = options.suffix;
    this.stageMs = options.stageMs ?? DEFAULT_STAGE_MS;
  }

  /** The id of the run that has not finished yet, if there is one. */
  activeRunId(): string | undefined {
    const run = this.latest;
    return run && this.clock.now() < this.finishTime(run)
      ? run.runId
      : undefined;
  }

  start(workflow: string, stageNames: readonly string[]): string {
    const startedAt = this.clock.now();
    const run = {
      runId: this.newRunId(startedAt),
      workflow,
      startedAt,
      order: [...stageNames],
    };
    this.runs.set(run.runId, run);
    this.latest = run;
    return run.runId;
  }

  get(runId: string): Run | undefined {
    const run = this.runs.get(runId);
    return run && this.describe(run);
  }

  private describe(run: StartedRun): Run {
    const done = this.clock.now() >= this.finishTime(run);
    const stages: Run['stages'] = {};
    run.order.forEach((name, index) => {
      stages[name] = { status: this.stageStatus(run, index) };
    });
    return {
      run_id: run.runId,
      workflow: run.workflow,
      harness: HARNESS,
      status: done ? 'passed' : 'running',
      started_at: toTimestamp(run.startedAt),
      finished_at: done ? toTimestamp(this.finishTime(run)) : null,
      exit_code: done ? 0 : null,
      order: [...run.order],
      stages,
    };
  }

  private stageStatus(run: StartedRun, index: number): StageStatus {
    const elapsed = Math.max(0, this.clock.now() - run.startedAt);
    const current = Math.floor(elapsed / this.stageMs);
    if (index < current) return 'passed';
    return index === current ? 'running' : 'pending';
  }

  private finishTime(run: StartedRun): number {
    return run.startedAt + run.order.length * this.stageMs;
  }

  private newRunId(startedAt: number): string {
    const [date, time] = toTimestamp(startedAt).split('T');
    const prefix = `${date?.replaceAll('-', '')}-${time?.slice(0, 5).replace(':', '')}`;
    let runId = `${prefix}-${this.suffix()}`;
    while (this.runs.has(runId)) runId = `${prefix}-${this.suffix()}`;
    return runId;
  }
}

// A UTC time to the whole second, ending in Z.
function toTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
