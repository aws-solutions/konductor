// SPDX-License-Identifier: Apache-2.0
import type { StageView } from '../../api/types';

/** A stage being edited. The `id` stays when the stage is renamed. */
export interface DraftStage {
  id: string;
  name: string;
  agent: string;
}

/** The stages of the workflow as edited, in run order. */
export interface Draft {
  stages: readonly DraftStage[];
  /** The number that the next new stage takes for its `id`. */
  nextId: number;
}

/** The most stages a workflow may have, as the API allows. */
export const MAX_STAGES = 40;

/** The agent of a stage that was just added. */
export const DEFAULT_AGENT = 'k-developer';

function idOf(number: number): string {
  return `s${number}`;
}

/** A draft that starts as the stages of a saved workflow. */
export function draftOf(stages: readonly StageView[]): Draft {
  return {
    stages: stages.map((stage, index) => ({ ...stage, id: idOf(index + 1) })),
    nextId: stages.length + 1,
  };
}

/** The stages of a draft as the API names them. */
export function stagesOf(draft: Draft): StageView[] {
  return draft.stages.map(({ name, agent }) => ({ name, agent }));
}

/** Whether two lists have the same stages, in the same order. */
export function sameStages(
  a: readonly StageView[],
  b: readonly StageView[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (stage, index) =>
        stage.name === b[index]?.name && stage.agent === b[index]?.agent,
    )
  );
}

/** Whether another stage may be added. */
export function canAddStage(draft: Draft): boolean {
  return draft.stages.length < MAX_STAGES;
}

/** Whether a stage may be deleted: a workflow keeps at least one. */
export function canRemoveStage(draft: Draft): boolean {
  return draft.stages.length > 1;
}

/** The first `agent-N` that no stage has, counting from 1: the next new stage's name. */
export function nextStageName(draft: Draft): string {
  const taken = new Set(draft.stages.map((stage) => stage.name));
  let number = 1;
  while (taken.has(`agent-${number}`)) number += 1;
  return `agent-${number}`;
}

/** Adds a stage with a free name and the default agent at the end. */
export function addStage(draft: Draft): Draft {
  if (!canAddStage(draft)) return draft;
  const stage = {
    id: idOf(draft.nextId),
    name: nextStageName(draft),
    agent: DEFAULT_AGENT,
  };
  return { stages: [...draft.stages, stage], nextId: draft.nextId + 1 };
}

function change(
  draft: Draft,
  id: string,
  edit: Partial<Pick<DraftStage, 'name' | 'agent'>>,
): Draft {
  return {
    ...draft,
    stages: draft.stages.map((stage) =>
      stage.id === id ? { ...stage, ...edit } : stage,
    ),
  };
}

/** Gives the stage a new name, as typed: the check judges it, not this. */
export function renameStage(draft: Draft, id: string, name: string): Draft {
  return change(draft, id, { name });
}

/** Gives the stage another agent. */
export function setAgent(draft: Draft, id: string, agent: string): Draft {
  return change(draft, id, { agent });
}

/** Deletes the stage; the last one stays, and an unknown id changes nothing. */
export function removeStage(draft: Draft, id: string): Draft {
  if (!canRemoveStage(draft)) return draft;
  const stages = draft.stages.filter((stage) => stage.id !== id);
  return stages.length === draft.stages.length ? draft : { ...draft, stages };
}

/**
 * The stage to select once `id` is gone: the one before it, or the one after
 * it when it was the first. `undefined` when the draft has no such stage.
 */
export function neighbourOf(draft: Draft, id: string): string | undefined {
  const index = draft.stages.findIndex((stage) => stage.id === id);
  if (index < 0) return undefined;
  return (draft.stages[index - 1] ?? draft.stages[index + 1])?.id;
}
