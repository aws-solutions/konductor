// SPDX-License-Identifier: Apache-2.0
import type { Clock } from './clock.ts';
import { HARNESS, MAX_GOAL_CHARS } from './contract.ts';
import type {
  CheckState,
  Run,
  RunEvent,
  RunStage,
  RunSummary,
  StageReason,
} from './model.ts';
import { scriptOf, type TimedEvent } from './run-events.ts';
import { formatTimestamp, runIdPrefix } from './timestamp.ts';

/** How long each simulated stage takes. */
export const DEFAULT_STAGE_MS = 3000;
/** How long a finished run keeps its console lines, as the contract says. */
export const CONSOLE_GRACE_MS = 60_000;
/** The most console lines of a run that are kept, the latest ones. */
export const MAX_CONSOLE_LINES = 1000;

/**
 * The checks of `intent.accept` as a run reports them: every id the workflow
 * declares, and the ids each stage's `done_when` names.
 */
export interface RunChecks {
  /** Every check id of `intent.accept`, so the run reports each one. */
  readonly ids: readonly string[];
  /** The check ids a stage's `done_when` names, by stage name. */
  readonly doneWhen: Readonly<Record<string, readonly string[]>>;
}

/** What a simulated run reports and how it ends. A run with no plan passes every stage. */
export interface RunPlan {
  /** The stage that is blocked, by its place in the list, and why. */
  block?: { at: number; reason: StageReason };
  /** The run never ends, as when another program holds it. */
  neverEnds?: boolean;
  /**
   * An output a stage leaves unwritten. The simulator writes the files a
   * stage declares, so this is how a caller asks for the case the runner
   * blocks: the first stage with an unwritten output is `OUTPUT_MISSING`.
   */
  unwritten?: { stage: string; output: string };
  /** The checks of the workflow. A run without them reports none. */
  checks?: RunChecks;
}

interface StartedRun {
  runId: string;
  workflow: string;
  startedAt: number;
  order: string[];
  plan: RunPlan;
  goal: string;
  script: TimedEvent[];
}

/** The events of a run that have happened by now. */
export interface EventsSoFar {
  /**
   * In order. Console lines are live only: a run keeps them, at most the last
   * `consoleLimit`, until `CONSOLE_GRACE_MS` after it finished.
   */
  events: RunEvent[];
  /** The highest `seq` the run has given out, console lines included. */
  lastSeq: number;
  finished: boolean;
  /** When the next event happens, while the run has one to come. */
  nextAt?: number;
}

export interface RunSimulatorOptions {
  clock: Clock;
  /** Five characters from `a-z0-9`, for the end of a run id. */
  suffix: () => string;
  stageMs?: number;
  /** The most console lines kept per run. The default is `MAX_CONSOLE_LINES`. */
  consoleLimit?: number;
}

/**
 * Fakes runs without running anything: each read works out the state from the
 * clock, with stages of `stageMs`. A stage passes unless the plan blocks it.
 */
export class RunSimulator {
  private readonly clock: Clock;
  private readonly suffix: () => string;
  private readonly stageMs: number;
  private readonly consoleLimit: number;
  private readonly runs = new Map<string, StartedRun>();
  private latest: StartedRun | undefined;

  constructor(options: RunSimulatorOptions) {
    this.clock = options.clock;
    this.suffix = options.suffix;
    this.stageMs = options.stageMs ?? DEFAULT_STAGE_MS;
    this.consoleLimit = options.consoleLimit ?? MAX_CONSOLE_LINES;
  }

  /** The id of the run that has not finished yet, if there is one. */
  activeRunId(): string | undefined {
    const run = this.latest;
    return run && !this.isDone(run) ? run.runId : undefined;
  }

  start(
    workflow: string,
    stageNames: readonly string[],
    goal: string,
    plan: RunPlan = {},
  ): string {
    const startedAt = this.clock.now();
    const runId = this.newRunId(startedAt);
    const order = [...stageNames];
    const normal = normalized(plan, order);
    const run = {
      runId,
      workflow,
      startedAt,
      order,
      plan: normal,
      goal,
      script: scriptOf({
        runId,
        startedAt,
        order,
        stageMs: this.stageMs,
        block: normal.block,
        neverEnds: normal.neverEnds,
      }),
    };
    this.runs.set(run.runId, run);
    this.latest = run;
    return run.runId;
  }

  /** The runs of `workflow` so far, newest first, at most `limit` of them. */
  list(workflow: string, limit: number): RunSummary[] {
    return [...this.runs.values()]
      .filter((run) => run.workflow === workflow)
      .reverse()
      .slice(0, limit)
      .map((run) => ({
        run_id: run.runId,
        started_at: formatTimestamp(run.startedAt),
        status: this.describe(run).status,
        ...cappedGoal(run.goal),
      }));
  }

  get(runId: string): Run | undefined {
    const run = this.runs.get(runId);
    return run && this.describe(run);
  }

  events(runId: string): EventsSoFar | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const now = this.clock.now();
    const happened = run.script.filter((timed) => timed.time <= now);
    const finished = this.isDone(run);
    const next = run.script.find((timed) => timed.time > now);
    const keepConsole =
      !finished || now < this.finishTime(run) + CONSOLE_GRACE_MS;
    const lines = happened.filter((timed) => timed.event.type === 'console');
    const kept = new Set(keepConsole ? lines.slice(-this.consoleLimit) : []);
    return {
      events: happened
        .filter((timed) => timed.event.type !== 'console' || kept.has(timed))
        .map((timed) => timed.event),
      lastSeq: happened.at(-1)?.event.seq ?? 0,
      finished,
      ...(next ? { nextAt: next.time } : {}),
    };
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
      checks: checkStates(run.plan.checks, stages),
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

// The list carries at most the session's goal limit, cut between code points.
/*
 * The state of each check the workflow declares, with the ids sorted, as the
 * run state the runner keeps has them. A check is `verified` once the server
 * has run it, and the runner runs a stage's `done_when` checks when that
 * stage passes, so a check named by a stage that has passed is verified here.
 * Every other one waits for a verify pass, so it is `deferred`.
 */
function checkStates(
  checks: RunChecks | undefined,
  stages: Run['stages'],
): Run['checks'] {
  if (!checks) return {};
  const ran = new Set(
    Object.entries(checks.doneWhen)
      .filter(([stage]) => stages[stage]?.status === 'passed')
      .flatMap(([, named]) => named),
  );
  const sorted = [...checks.ids].sort();
  return Object.fromEntries(
    sorted.map((id): [string, CheckState] => [
      id,
      ran.has(id) ? 'verified' : 'deferred',
    ]),
  );
}

function cappedGoal(goal: string): Pick<RunSummary, 'goal' | 'goal_truncated'> {
  const chars = [...goal];
  const goal_truncated = chars.length > MAX_GOAL_CHARS;
  const kept = goal_truncated ? chars.slice(0, MAX_GOAL_CHARS).join('') : goal;
  return { goal: kept, goal_truncated };
}

// An output a stage did not write blocks that stage, which is what the runner
// does when a declared file is not there. A blocked stage past the end of the
// list is the last one.
function normalized(plan: RunPlan, order: readonly string[]): RunPlan {
  const withBlock = plan.block ? plan : blockForUnwritten(plan, order);
  const { block } = withBlock;
  if (!block) return withBlock;
  return {
    ...withBlock,
    block: { ...block, at: Math.min(block.at, order.length - 1) },
  };
}

function blockForUnwritten(plan: RunPlan, order: readonly string[]): RunPlan {
  const at = plan.unwritten ? order.indexOf(plan.unwritten.stage) : -1;
  if (at === -1) return plan;
  return { ...plan, block: { at, reason: 'OUTPUT_MISSING' } };
}
