// SPDX-License-Identifier: Apache-2.0
import type { DraftStage } from '../designer/core/draft';
import type { CheckView, CheckViewStage } from '../designer-view/yaml-draft';
import type { MarkedStage } from '../designer-view/YamlPane';
import type { FieldValues } from '../designer-view/field-rules';

/**
 * The keys of a stage the editor has an event for, so the form lets a person
 * type in them. Every other key of the stage is shown read-only: a save keeps
 * each of its bytes, but nothing on the page can change it yet.
 */
export const SAVABLE_KEYS: readonly string[] = ['name', 'agent', 'prompt'];

/** The keys that the server works out, which are not keys of the file. */
const DERIVED_KEYS: ReadonlySet<string> = new Set(['kind', 'range']);

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
 * no stage for.
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

/** How far a view of the text can be trusted to name the draft's stages. */
export interface ViewStanding {
  /** The view is not of the text as it is now, but of an earlier one. */
  readonly stale: boolean;
  /** Where each stage of the draft came from, in the order of the draft. */
  readonly sources: readonly StageSource[];
}

// Whether the draft still holds the stages of the file, each in its own
// place: no stage added, none deleted, none moved. Only then is a view of an
// earlier text of this session a view of these stages, because the only edits
// since are names and agents, which do not move a stage.
function keepsTheFilesStages(sources: readonly StageSource[]): boolean {
  return sources.every(
    (source, index) => source.kind === 'loaded' && source.index === index,
  );
}

/**
 * The stage of `view` that `picked` is, or `undefined` when it cannot be
 * told.
 *
 * A view of the text as it is now has the stages of the draft, in its order,
 * so the place in the draft names the stage. An earlier view is read by that
 * place only while the draft still holds the stages of the file, each where
 * the file has it: a stage added or deleted since has moved the stages after
 * it, and deleting one and adding another leaves the count alone while naming
 * other stages, so such a view is of no use here. Nor is the name, which a
 * person renaming a stage to the name of another one would be shown that
 * other stage by. The stage is then untold until the check of this text
 * answers.
 *
 * The file as it was loaded is read by `sourceStageOf` instead, which takes
 * the place a stage was loaded from.
 */
export function pickedStageOf(
  view: CheckView | null | undefined,
  picked: PickedStage,
  standing: ViewStanding,
): CheckViewStage | undefined {
  if (view === null || view === undefined) return undefined;
  if (view.stages.length !== picked.total) return undefined;
  if (standing.stale && !keepsTheFilesStages(standing.sources)) {
    return undefined;
  }
  return view.stages[picked.index];
}

/**
 * The lines of the picked stage to mark in the text, or `undefined` when
 * they cannot be told. A mark only helps a person find the stage, so a range
 * that cannot be read leaves the text unmarked rather than failing the view.
 */
export function markedStageOf(
  view: CheckView | null | undefined,
  picked: PickedStage,
  standing: ViewStanding,
): MarkedStage | undefined {
  const stage = pickedStageOf(view, picked, standing);
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
 * the view, with the name, the agent and the prompt of the draft over them,
 * because those three are what the editor holds while a person types. A
 * prompt the editor could not read is left out, so the stage's own value
 * from the view is shown and stays read-only. A key whose value is not text,
 * such as a mapping or a list, is left out: the form writes text, and the
 * text keeps such a key as it is.
 */
export function fieldValuesOf(
  stage: CheckViewStage | undefined,
  draft: DraftStage,
  { promptRead = true }: { readonly promptRead?: boolean } = {},
): FieldValues {
  const fromView = Object.entries(stage ?? {}).filter(
    ([key, value]) => typeof value === 'string' && !DERIVED_KEYS.has(key),
  ) as [string, string][];
  return {
    ...Object.fromEntries(fromView),
    name: draft.name,
    agent: draft.agent,
    ...(promptRead ? { prompt: draft.prompt } : {}),
  };
}
