// SPDX-License-Identifier: Apache-2.0
import type { EditableCheck, ParamView, StageKeys } from '../../api/types';

/** A parameter declaration being edited. */
export interface DraftParam {
  readonly id: string;
  readonly isGoal: boolean;
  readonly sourceIndex?: number;
  readonly name: string;
  readonly description: string;
  readonly default: string;
  readonly required: boolean;
}

/** One editable acceptance check. */
export interface DraftCheck {
  readonly key: string;
  readonly sourceIndex?: number;
  readonly id: string;
  readonly kind: 'file' | 'run';
  readonly file: string;
  readonly run: readonly string[];
}

/** One editable output declaration. */
export interface DraftOutput {
  readonly id: string;
  readonly sourceIndex?: number;
  readonly name: string;
  readonly path: string;
}

/** A stage being edited. The `id` stays when the stage is renamed. */
export interface DraftStage {
  id: string;
  name: string;
  agent: string;
  /**
   * The text of the stage's `prompt` as typed, or the empty string for none.
   * A stage that reads its prompt from a file has the empty string and no
   * way to change it here.
   */
  prompt: string;
  outputs?: readonly DraftOutput[];
  nextOutputId?: number;
}

/** The editable workflow declaration. */
export interface Draft {
  stages: readonly DraftStage[];
  params: readonly DraftParam[];
  checks?: readonly DraftCheck[];
  /** The number that the next new stage takes for its `id`. */
  nextId: number;
  nextParamId: number;
  nextCheckId?: number;
}

/** The most stages a workflow may have, as the API allows. */
export const MAX_STAGES = 40;

/** The most characters a prompt may have, as the API and the spec allow. */
export const MAX_PROMPT_CHARS = 32768;

/** The agent of a stage that was just added. */
export const DEFAULT_AGENT = 'k-developer';

function idOf(number: number): string {
  return `s${number}`;
}

/**
 * A draft that starts as the stages of a saved workflow, each with the prompt
 * of the same place in `prompts` (none when the list is short).
 */
export function draftOf(
  stages: readonly StageKeys[],
  prompts: readonly string[] = [],
  params: Readonly<Record<string, ParamView>> = {},
  checks: readonly EditableCheck[] = [],
): Draft {
  const declarations = Object.entries(params);
  let nextParamId = 1;
  const draftParams: DraftParam[] = declarations.map(
    ([name, param], sourceIndex) => {
      const isGoal = name === 'goal';
      return {
        id: isGoal ? 'p-goal' : `p${nextParamId++}`,
        isGoal,
        sourceIndex,
        name,
        description: param.description ?? '',
        default: param.default ?? '',
        required: param.required ?? false,
      };
    },
  );
  if (!draftParams.some((param) => param.isGoal)) {
    draftParams.unshift({
      id: 'p-goal',
      isGoal: true,
      name: 'goal',
      description: '',
      default: '',
      required: false,
    });
  }
  return {
    stages: stages.map((stage, index) => ({
      ...stage,
      id: idOf(index + 1),
      prompt: prompts[index] ?? '',
      outputs: Object.entries(stage.outputs ?? {}).map(
        ([name, path], outputIndex) => ({
          id: `${idOf(index + 1)}-o${outputIndex + 1}`,
          sourceIndex: outputIndex,
          name,
          path,
        }),
      ),
      nextOutputId: Object.keys(stage.outputs ?? {}).length + 1,
    })),
    params: draftParams,
    checks: checks.map((check, index) => ({
      key: `c${index + 1}`,
      sourceIndex: index,
      id: check.id,
      kind: check.run === undefined ? 'file' : 'run',
      file: check.file ?? '',
      run: check.run ?? [],
    })),
    nextId: stages.length + 1,
    nextParamId,
    nextCheckId: checks.length + 1,
  };
}

export interface SubmittedOutputRows {
  readonly stageId: string;
  readonly outputIds: readonly string[];
}

/** Rebinds submitted rows to their positions in the saved response. */
export function rebaseOutputSources(
  draft: Draft,
  stages: readonly StageKeys[],
  submitted: readonly SubmittedOutputRows[],
): Draft {
  return {
    ...draft,
    stages: draft.stages.map((stage) => {
      const stageIndex = submitted.findIndex(
        ({ stageId }) => stageId === stage.id,
      );
      if (stageIndex < 0) return stage;
      const sourceIds = submitted[stageIndex]!.outputIds;
      const savedCount = Object.keys(stages[stageIndex]?.outputs ?? {}).length;
      return {
        ...stage,
        outputs: (stage.outputs ?? []).map((output) => {
          const sourceIndex = sourceIds.indexOf(output.id);
          if (sourceIndex >= 0 && sourceIndex < savedCount) {
            return { ...output, sourceIndex };
          }
          return {
            id: output.id,
            name: output.name,
            path: output.path,
          };
        }),
      };
    }),
  };
}

/** Rebinds submitted check keys to their positions in the saved response. */
export function rebaseCheckSources(
  draft: Draft,
  checks: readonly EditableCheck[],
  submittedKeys: readonly string[],
): Draft {
  return {
    ...draft,
    checks: (draft.checks ?? []).map((check) => {
      const sourceIndex = submittedKeys.indexOf(check.key);
      if (sourceIndex >= 0 && sourceIndex < checks.length) {
        return { ...check, sourceIndex };
      }
      return {
        key: check.key,
        id: check.id,
        kind: check.kind,
        file: check.file,
        run: check.run,
      };
    }),
  };
}

/** The stages of a draft as the API names them. */
export function stagesOf(draft: Draft): StageKeys[] {
  return draft.stages.map(({ name, agent }) => ({ name, agent }));
}

/** The ids of the stages of a draft, in order. */
export function idsOf(draft: Draft): string[] {
  return draft.stages.map((stage) => stage.id);
}

/** The ids of source-backed params in their original order. */
export function sourceParamIds(draft: Draft): string[] {
  return draft.params
    .filter((param) => param.sourceIndex !== undefined)
    .sort((left, right) => left.sourceIndex! - right.sourceIndex!)
    .map((param) => param.id);
}

/** Whether two lists have the same stages, in the same order. */
export function sameStages(
  a: readonly StageKeys[],
  b: readonly StageKeys[],
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

/** Inserts a stage with a free name and the requested agent. */
export function insertStage(draft: Draft, index: number, agent: string): Draft {
  if (!canAddStage(draft)) return draft;
  const stage = {
    id: idOf(draft.nextId),
    name: nextStageName(draft),
    agent,
    prompt: '',
    outputs: [],
    nextOutputId: 1,
  };
  const at = Math.max(0, Math.min(index, draft.stages.length));
  return {
    ...draft,
    stages: [...draft.stages.slice(0, at), stage, ...draft.stages.slice(at)],
    nextId: draft.nextId + 1,
  };
}

/** Adds a stage with a free name and the default agent at the end. */
export function addStage(draft: Draft): Draft {
  return insertStage(draft, draft.stages.length, DEFAULT_AGENT);
}

function change(
  draft: Draft,
  id: string,
  edit: Partial<
    Pick<DraftStage, 'name' | 'agent' | 'prompt' | 'outputs' | 'nextOutputId'>
  >,
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

/** Gives the stage the prompt as typed; the writer and the check judge it. */
export function setPrompt(draft: Draft, id: string, prompt: string): Draft {
  return change(draft, id, { prompt });
}

/** Changes one output row of a stage. */
export function setOutput(
  draft: Draft,
  stageId: string,
  outputId: string,
  output: Pick<DraftOutput, 'name' | 'path'>,
): Draft {
  const stage = draft.stages.find((candidate) => candidate.id === stageId);
  const outputs = stage?.outputs ?? [];
  if (!stage || !outputs.some((candidate) => candidate.id === outputId)) {
    return draft;
  }
  return change(draft, stageId, {
    outputs: outputs.map((candidate) =>
      candidate.id === outputId ? { ...candidate, ...output } : candidate,
    ),
  });
}

/** Adds a blank output row to a stage. */
export function addOutput(draft: Draft, stageId: string): Draft {
  const stage = draft.stages.find((candidate) => candidate.id === stageId);
  if (!stage) return draft;
  const outputs = stage.outputs ?? [];
  const nextOutputId = stage.nextOutputId ?? 1;
  const id = `${stage.id}-o${nextOutputId}`;
  return change(draft, stageId, {
    outputs: [...outputs, { id, name: '', path: '' }],
    nextOutputId: nextOutputId + 1,
  });
}

/** Removes one output row from a stage. */
export function removeOutput(
  draft: Draft,
  stageId: string,
  outputId: string,
): Draft {
  const stage = draft.stages.find((candidate) => candidate.id === stageId);
  if (!stage) return draft;
  const before = stage.outputs ?? [];
  const outputs = before.filter((output) => output.id !== outputId);
  return outputs.length === before.length
    ? draft
    : change(draft, stageId, { outputs });
}

/** Changes one acceptance check. */
export function setCheck(
  draft: Draft,
  key: string,
  check: Omit<DraftCheck, 'key' | 'sourceIndex'>,
): Draft {
  if (!(draft.checks ?? []).some((candidate) => candidate.key === key)) {
    return draft;
  }
  return {
    ...draft,
    checks: (draft.checks ?? []).map((candidate) =>
      candidate.key === key ? { ...candidate, ...check } : candidate,
    ),
  };
}

/** Adds a file check with a free id. */
export function addCheck(draft: Draft): Draft {
  const checks = draft.checks ?? [];
  let number = 1;
  const ids = new Set(checks.map((check) => check.id));
  while (ids.has(`check-${number}`)) number += 1;
  const next = draft.nextCheckId ?? 1;
  return {
    ...draft,
    checks: [
      ...checks,
      {
        key: `c${next}`,
        id: `check-${number}`,
        kind: 'file',
        file: '',
        run: [],
      },
    ],
    nextCheckId: next + 1,
  };
}

/** Removes one acceptance check. */
export function removeCheck(draft: Draft, key: string): Draft {
  const checks = draft.checks ?? [];
  if (!checks.some((check) => check.key === key)) return draft;
  return {
    ...draft,
    checks: checks.filter((check) => check.key !== key),
  };
}

/** Gives a parameter field the value as typed. */
export function setParam(
  draft: Draft,
  id: string,
  change: Partial<
    Pick<DraftParam, 'name' | 'description' | 'default' | 'required'>
  >,
): Draft {
  return {
    ...draft,
    params: draft.params.map((param) => {
      if (param.id !== id) return param;
      if (!param.isGoal) return { ...param, ...change };
      const goalChange = { ...change };
      delete goalChange.name;
      return { ...param, ...goalChange };
    }),
  };
}

/** Adds a string parameter with the first free `param_N` name. */
export function addParam(draft: Draft): Draft {
  const names = new Set(draft.params.map((param) => param.name));
  let number = 1;
  while (names.has(`param_${number}`)) number += 1;
  return {
    ...draft,
    params: [
      ...draft.params,
      {
        id: `p${draft.nextParamId}`,
        isGoal: false,
        name: `param_${number}`,
        description: '',
        default: '',
        required: false,
      },
    ],
    nextParamId: draft.nextParamId + 1,
  };
}

/** Removes a parameter other than the protected goal row. */
export function removeParam(draft: Draft, id: string): Draft {
  const param = draft.params.find((candidate) => candidate.id === id);
  if (!param || param.isGoal) return draft;
  return {
    ...draft,
    params: draft.params.filter((candidate) => candidate.id !== id),
  };
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
