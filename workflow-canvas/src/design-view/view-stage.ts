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
 * Where a stage of the draft comes from in the file as it was loaded: the
 * place it had there, or `added` for a stage made since, which the file has
 * no stage for and so has nothing to lose.
 *
 * A place, not a name and not the current position: a person renames a stage
 * and adds and deletes others, and only the place it was loaded from still
 * names the lines the file holds for it.
 */
export type StageSource =
  | { readonly kind: 'loaded'; readonly index: number }
  | { readonly kind: 'added' };

/**
 * The stage of the file that `source` came from, or `undefined` when the file
 * has none: a stage added since, or a file that is not known, as it is not
 * while the first check is in flight or after it failed.
 */
export function sourceStageOf(
  file: CheckView | null | undefined,
  source: StageSource,
): CheckViewStage | undefined {
  if (source.kind === 'added') return undefined;
  return file?.stages[source.index];
}

/**
 * The stage of `view` that `picked` is, or `undefined` when it cannot be
 * told.
 *
 * This reads a view of the text as it is now, whose stages are in the order
 * of the draft, so the place in the draft names the stage. A view of another
 * number of stages is of another text: it is of no use here, because a stage
 * added or deleted since has moved every stage after it, and the name cannot
 * stand in for the place, as a person renaming a stage to the name of another
 * one would then be shown that other stage. Such a view leaves the stage
 * untold until a check of this text answers.
 *
 * The file as it was loaded is read by `sourceStageOf` instead, which takes
 * the place a stage was loaded from, the same identity the save guard holds.
 */
export function pickedStageOf(
  view: CheckView | null | undefined,
  picked: PickedStage,
): CheckViewStage | undefined {
  if (view === null || view === undefined) return undefined;
  return view.stages.length === picked.total
    ? view.stages[picked.index]
    : undefined;
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

/** A stage of the draft, as the save guard reads it. */
export interface GuardedStage {
  readonly draft: DraftStage;
  /** Where in the file as loaded this stage came from. */
  readonly source: StageSource;
  /** Whether the person has changed its name or its agent since the load. */
  readonly changed: boolean;
}

const ONLY_TWO = 'Only the name and the agent of a stage can be saved yet.';

/**
 * Why a save of this workflow is refused, or `undefined` when it may go
 * ahead. The stage writer of the editor rebuilds a stage it changed from the
 * name and the agent alone, so saving a stage that has another key, such as a
 * prompt, would drop it from the file. Until the writer keeps those keys, a
 * change to such a stage is not saved at all.
 *
 * The guard fails closed. A changed stage whose file stage cannot be read is
 * refused as well, because the keys it would drop are then unknown: that is
 * so while the first check of the file is in flight, after that check failed,
 * and for a file that has no stage at the place this one was loaded from. A
 * stage the person added has nothing in the file to lose, and an unchanged
 * stage keeps its own lines, so neither is refused.
 */
export function saveRefusal(
  stages: readonly GuardedStage[],
  /** The file as it was loaded, or `null` while it is not known. */
  file: CheckView | null | undefined,
): string | undefined {
  for (const stage of stages) {
    if (!stage.changed || stage.source.kind === 'added') continue;
    const name = stage.draft.name;
    const saved = sourceStageOf(file, stage.source);
    if (saved === undefined) {
      return `A save would rebuild ${name}, and the keys it has in the file are not known, so it is refused. ${ONLY_TWO}`;
    }
    const dropped = droppedKeysOf(saved);
    if (dropped.length > 0) {
      return `A save would drop the ${dropped.join(' and ')} of ${name}, so it is refused. ${ONLY_TWO}`;
    }
  }
  return undefined;
}
