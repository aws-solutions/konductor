// SPDX-License-Identifier: Apache-2.0
import type { RunEvent, RunStage, StageReason } from './model.ts';
import { formatTimestamp } from './timestamp.ts';

/** What the script of a run needs to know about it. */
export interface ScriptedRun {
  runId: string;
  startedAt: number;
  order: readonly string[];
  stageMs: number;
  block?: { at: number; reason: StageReason };
  neverEnds?: boolean;
}

/** An event of the script, with the time it happens at. */
export interface TimedEvent {
  time: number;
  event: RunEvent;
}

/** The lines each stage prints, at a third and at two thirds of its time. */
export const CONSOLE_LINES: readonly ((stage: string) => string)[] = [
  (stage) => `Working on the ${stage} stage.`,
  (stage) => `Writing the result of the ${stage} stage.`,
];

type Draft = { time: number } & (
  | { type: 'stage_state'; stage: string; state: RunStage }
  | { type: 'console'; stage: string; n: number; text: string }
  | { type: 'run_finished'; halted: boolean }
);

/**
 * Every event of a simulated run, in order, numbered from 1. It agrees with
 * the run's state at every time: a stage runs for `stageMs`, then passes or
 * is blocked, and the run finishes when its last timed stage ends.
 */
export function scriptOf(run: ScriptedRun): TimedEvent[] {
  return draftsOf(run).map((draft, index) => ({
    time: draft.time,
    event: toEvent(draft, index + 1, run.runId),
  }));
}

function draftsOf(run: ScriptedRun): Draft[] {
  const { order, stageMs, block, neverEnds, startedAt } = run;
  const timed = neverEnds ? 1 : (block?.at ?? order.length - 1) + 1;
  const drafts: Draft[] = [];
  for (let index = 0; index < timed; index++) {
    const stage = order[index] ?? '';
    const begin = startedAt + index * stageMs;
    drafts.push({
      time: begin,
      type: 'stage_state',
      stage,
      state: { status: 'running' },
    });
    CONSOLE_LINES.forEach((line, i) => {
      const time = begin + Math.floor(((i + 1) * stageMs) / 3);
      drafts.push({
        time,
        type: 'console',
        stage,
        n: i + 1,
        text: line(stage),
      });
    });
    if (neverEnds) return drafts;
    drafts.push({
      time: begin + stageMs,
      type: 'stage_state',
      stage,
      state:
        block?.at === index
          ? { status: 'blocked', reason: block.reason }
          : { status: 'passed' },
    });
  }
  drafts.push({
    time: startedAt + timed * stageMs,
    type: 'run_finished',
    halted: block !== undefined,
  });
  return drafts;
}

function toEvent(draft: Draft, seq: number, runId: string): RunEvent {
  const base = { seq, run_id: runId, at: formatTimestamp(draft.time) };
  switch (draft.type) {
    case 'stage_state':
      return {
        ...base,
        type: 'stage_state',
        stage: draft.stage,
        ...draft.state,
      };
    case 'console': {
      const { stage, n, text } = draft;
      return { ...base, type: 'console', stage, n, text };
    }
    case 'run_finished':
      return {
        ...base,
        type: 'run_finished',
        status: draft.halted ? 'halted' : 'passed',
        exit_code: draft.halted ? 1 : 0,
      };
  }
}
