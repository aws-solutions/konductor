// SPDX-License-Identifier: Apache-2.0
import type { DraftStage } from '../designer/core/draft';
import type { CheckView, CheckViewStage } from '../designer-view/yaml-draft';
import type { MarkedStage } from '../designer-view/YamlPane';
import type { FieldValues } from '../designer-view/field-rules';

/** The keys of a stage that the editor can write today. */
export const SAVABLE_KEYS: readonly string[] = ['name', 'agent'];

/** The keys that the server works out, which are not keys of the file. */
const DERIVED_KEYS: ReadonlySet<string> = new Set(['kind', 'range']);

/**
 * The keys of a stage that a save would drop: every key of the file but the
 * name and the agent, which are the only ones the editor's reducer has an
 * event for. The stage writer rebuilds a stage it is given, so a save of a
 * stage with any of these would lose them.
 */
export function droppedKeysOf(
  stage: CheckViewStage | undefined,
): readonly string[] {
  return Object.entries(stage ?? {})
    .filter(
      ([key, value]) =>
        typeof value !== 'undefined' &&
        !DERIVED_KEYS.has(key) &&
        !SAVABLE_KEYS.includes(key),
    )
    .map(([key]) => key)
    .sort();
}

/** The stage of `view` called `name`, or `undefined` when it has none. */
export function checkStageOf(
  view: CheckView | null | undefined,
  name: string,
): CheckViewStage | undefined {
  return view?.stages.find((stage) => stage.name === name);
}

function wholeLine(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 1
    ? (value as number)
    : undefined;
}

/** Which stage of the drawing is picked, as the editor's draft holds it. */
export interface PickedStage {
  readonly name: string;
  /** Its place in the stages of the draft, from 0. */
  readonly index: number;
  /** How many stages the draft has. */
  readonly total: number;
}

/**
 * The stage of `view` that `picked` is, or `undefined` when it cannot be
 * told. The position decides when the view has as many stages as the draft,
 * because a name is not unique while a person types: a stage renamed to the
 * name of another one would otherwise resolve to that other stage. A name
 * match is taken only when the view has another number of stages, where a
 * position means nothing.
 */
export function pickedStageOf(
  view: CheckView | null | undefined,
  picked: PickedStage,
): CheckViewStage | undefined {
  if (view === null || view === undefined) return undefined;
  return view.stages.length === picked.total
    ? view.stages[picked.index]
    : checkStageOf(view, picked.name);
}

/**
 * The lines of the picked stage to mark in the text, or `undefined` when
 * they cannot be told. A mark only helps a person find the stage, so a range
 * that cannot be read leaves the text unmarked rather than failing the view.
 */
export function markedStageOf(
  view: CheckView | null | undefined,
  picked: PickedStage,
): MarkedStage | undefined {
  const stage = pickedStageOf(view, picked);
  if (stage === undefined) return undefined;
  const range = stage.range;
  if (typeof range !== 'object' || range === null) return undefined;
  const { line, end_line: endLine } = range as Record<string, unknown>;
  const first = wholeLine(line);
  const last = wholeLine(endLine);
  if (first === undefined || last === undefined || last < first) {
    return undefined;
  }
  return { name: picked.name, range: { line: first, end_line: last } };
}

/**
 * The keys of the stage to show in the form: the text keys of the stage in
 * the view, with the name and the agent of the draft over them, because
 * those two are what the editor holds while a person types. A key whose
 * value is not text, such as a mapping or a list, is left out: the form
 * writes text, and the text keeps such a key as it is.
 */
export function fieldValuesOf(
  stage: CheckViewStage | undefined,
  draft: DraftStage,
): FieldValues {
  const fromView = Object.entries(stage ?? {}).filter(
    ([key, value]) => typeof value === 'string' && !DERIVED_KEYS.has(key),
  ) as [string, string][];
  return {
    ...Object.fromEntries(fromView),
    name: draft.name,
    agent: draft.agent,
  };
}

/**
 * Why a save of this workflow is refused, or `undefined` when it may go
 * ahead. The stage writer of the editor rebuilds a stage it changed from the
 * name and the agent alone, so saving a stage that has another key, such as a
 * prompt, would drop it from the file. Until the writer keeps those keys, a
 * change to such a stage is not saved at all.
 */
export function saveRefusal(
  stages: readonly {
    readonly draft: DraftStage;
    readonly saved: CheckViewStage | undefined;
    readonly changed: boolean;
  }[],
): string | undefined {
  const atRisk = stages
    .filter((stage) => stage.changed)
    .map((stage) => ({
      name: stage.draft.name,
      dropped: droppedKeysOf(stage.saved),
    }))
    .filter((stage) => stage.dropped.length > 0);
  const first = atRisk[0];
  if (first === undefined) return undefined;
  return `A save would drop the ${first.dropped.join(' and ')} of ${first.name}, so it is refused. Only the name and the agent of a stage can be saved yet.`;
}
