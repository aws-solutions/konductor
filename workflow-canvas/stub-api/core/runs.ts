// SPDX-License-Identifier: Apache-2.0
import type { Clock } from './clock.ts';
import { HARNESS } from './contract.ts';
import type { Run, RunStage, StageReason } from './model.ts';
import { formatTimestamp, runIdPrefix } from './timestamp.ts';

/** How long each simulated stage takes. */
export const DEFAULT_STAGE_MS = 3000;

/** How a simulated run ends. A run with no plan passes every stage. */
export interface RunPlan {
  /** The stage that is blocked, by its place in the list, and why. */
  block?: { at: number; reason: StageReason };
  /** The run never ends, as when another program holds it. */
  neverEnds?: boolean;
}

interface StartedRun {
  runId: string;
  workflow: string;
  startedAt: number;
  order: string[];
  plan: RunPlan;
}

export interface RunSimulatorOptions {
  clock: Clock;
  /** Five characters from `a-z0-9`, for the end of a run id. */
  suffix: () => string;
  stageMs?: number;
}

/**
 * Fakes runs without running anything: each read works out the state from the
 * clock, with stages of `stageMs`. A stage passes unless the plan blocks it.
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
    return run && !this.isDone(run) ? run.runId : undefined;
  }

  start(
    workflow: string,
    stageNames: readonly string[],
    plan: RunPlan = {},
  ): string {
    const startedAt = this.clock.now();
    const run = {
      runId: this.newRunId(startedAt),
      workflow,
      startedAt,
      order: [...stageNames],
      plan: normalized(plan, stageNames.length),
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
    const done = this.isDone(run);
    const stages: Run['stages'] = {};
    run.order.forEach((name, index) => {
      stages[name] = this.stageState(run, index, done);
    });
    const halted = done && run.plan.block !== undefined;
    return {
      run_id: run.runId,
      workflow: run.workflow,
      harness: HARNESS,
      status: !done ? 'running' : halted ? 'halted' : 'passed',
      started_at: formatTimestamp(run.startedAt),
      finished_at: done ? formatTimestamp(this.finishTime(run)) : null,
      exit_code: !done ? null : halted ? 1 : 0,
      order: [...run.order],
      stages,
    };
  }

  private stageState(run: StartedRun, index: number, done: boolean): RunStage {
    const { block } = run.plan;
    if (done && block) {
      if (index < block.at) return { status: 'passed' };
      if (index === block.at)
        return { status: 'blocked', reason: block.reason };
      return { status: 'pending' };
    }
    if (done) return { status: 'passed' };
    const elapsed = Math.max(0, this.clock.now() - run.startedAt);
    // A run that never ends stays in its first stage.
    const current = run.plan.neverEnds ? 0 : Math.floor(elapsed / this.stageMs);
    if (index < current) return { status: 'passed' };
    return { status: index === current ? 'running' : 'pending' };
  }

  // A run ends when its last timed stage ends: the blocked one, or the last.
  private isDone(run: StartedRun): boolean {
    return !run.plan.neverEnds && this.clock.now() >= this.finishTime(run);
  }

  private finishTime(run: StartedRun): number {
    const timed = (run.plan.block?.at ?? run.order.length - 1) + 1;
    return run.startedAt + timed * this.stageMs;
  }

  private newRunId(startedAt: number): string {
    const prefix = runIdPrefix(startedAt);
    let runId = `${prefix}-${this.suffix()}`;
    while (this.runs.has(runId)) runId = `${prefix}-${this.suffix()}`;
    return runId;
  }
}

// A blocked stage past the end of the list is the last one.
function normalized(plan: RunPlan, stageCount: number): RunPlan {
  const { block } = plan;
  if (!block) return plan;
  return {
    ...plan,
    block: { ...block, at: Math.min(block.at, stageCount - 1) },
  };
}
