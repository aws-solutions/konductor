// SPDX-License-Identifier: Apache-2.0
import type { ParamDeclaration } from '../api/workflow-extras';

/**
 * The most characters a param value may have, as `api/openapi.yaml` gives it:
 * 65536 (64 KiB). Characters are code points, as everywhere the contract
 * counts them, so a value written outside the first plane is measured as a
 * person reads it. The goal has its own, smaller limit in
 * `execution/core/goal.ts`.
 */
export const PARAM_MAX_LENGTH = 65_536;

/** What a person has typed for each param, by name. */
export type ParamTexts = Readonly<Record<string, string>>;

/**
 * What the page knows about the params a workflow declares. A workflow that
 * declares none is `ready` with an empty list, which is not the same as not
 * having been told: a run must not start with inputs the page has not read,
 * because it would send the goal alone and leave every typed value behind.
 */
export type ParamsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'ready'; readonly declared: readonly ParamDeclaration[] };

/** The params of a page that has read nothing yet. */
export const PARAMS_LOADING: ParamsState = { kind: 'loading' };

/** The declared params of a state that has them, and none while it has not. */
export function declaredParamsOf(
  state: ParamsState,
): readonly ParamDeclaration[] {
  return state.kind === 'ready' ? state.declared : NO_DECLARED;
}

const NO_DECLARED: readonly ParamDeclaration[] = [];

const STILL_READING =
  'The inputs this workflow takes are still being read from the server.';

/**
 * Why the params stop a run while the page has not been told what they are,
 * as a sentence for the Run button, or `undefined` once it has. A read that
 * failed carries its own reason, which the page also shows above the view.
 */
export function paramsUnknownProblem(state: ParamsState): string | undefined {
  if (state.kind === 'ready') return undefined;
  return state.kind === 'failed' ? state.reason : STILL_READING;
}

/** The typed texts with only the names given kept, as own keys. */
export function keptParams(
  typed: ParamTexts,
  names: ReadonlySet<string>,
): ParamTexts {
  return Object.fromEntries(
    Object.entries(typed).filter(([name]) => names.has(name)),
  );
}

/** The `params` of `POST /api/run`: the goal, and a value for each param sent. */
export type RunParams = Readonly<Record<string, string>>;

/**
 * Starts a run with those params and resolves to its id. It rejects with
 * `RunAlreadyActive` when the server already has a run, and with
 * `RunStartUnsure` when the outcome of the start is not known.
 */
export type StartRun = (
  params: RunParams,
  signal: AbortSignal,
) => Promise<string>;

/** One param box of the Run view. */
export interface ParamBox {
  readonly name: string;
  /** The text to show: what was typed, or the declared default until then. */
  readonly value: string;
  readonly description?: string;
  readonly required: boolean;
  /**
   * Whether the workflow declares a default for it. An empty box of a param
   * with a default is not a missing value: the run takes the default.
   */
  readonly hasDefault: boolean;
  /** Why the value cannot be sent, as a sentence, or `undefined` when it can. */
  readonly problem?: string;
}

/**
 * Why a param value cannot be sent, as a sentence for a person, or
 * `undefined` when it can. Length is the only rule: the API takes any string
 * within the limit.
 */
export function paramProblem(value: string): string | undefined {
  return [...value].length > PARAM_MAX_LENGTH
    ? `This value can have at most ${PARAM_MAX_LENGTH} characters.`
    : undefined;
}

/*
 * Whether the box holds a value to send. Only an empty box holds none: the
 * API takes any other string, white space included, so trimming here would
 * drop a value the server would have accepted.
 */
function hasValue(value: string): boolean {
  return value !== '';
}

/**
 * The text of one param box: what the person typed, or the declared default
 * until they type. A box the person cleared stays empty, because the typed
 * text is then the empty string, not `undefined`.
 */
function textOf(declared: ParamDeclaration, typed: ParamTexts): string {
  const own = Object.hasOwn(typed, declared.name)
    ? typed[declared.name]
    : undefined;
  return own ?? declared.default ?? '';
}

/**
 * The boxes to draw for the declared params, in the order of the file, with
 * the default prefilled until the person types.
 */
export function paramBoxes(
  declared: readonly ParamDeclaration[],
  typed: ParamTexts,
): readonly ParamBox[] {
  return declared.map((param) => {
    const value = textOf(param, typed);
    const problem = paramProblem(value);
    return {
      name: param.name,
      value,
      required: param.required,
      hasDefault: param.default !== undefined,
      ...(param.description === undefined
        ? {}
        : { description: param.description }),
      ...(problem === undefined ? {} : { problem }),
    };
  });
}

/** The typed texts with one box's text put in, as own keys only. */
export function withParam(
  typed: ParamTexts,
  name: string,
  text: string,
): ParamTexts {
  return Object.fromEntries([...Object.entries(typed), [name, text]]);
}

/**
 * Why the params stop a run, as a sentence for the Run button, or `undefined`
 * when they do not. A required param with no value and no default is named,
 * and so is the first value that is too long: the server would refuse both,
 * so the button says why before the call is made. An empty box of a param
 * that has a default stops nothing, because the run takes that default.
 */
export function paramsProblem(boxes: readonly ParamBox[]): string | undefined {
  const tooLong = boxes.find((box) => box.problem !== undefined);
  if (tooLong) {
    return `The value of ${tooLong.name} can have at most ${PARAM_MAX_LENGTH} characters.`;
  }
  const missing = boxes.find(
    (box) => box.required && !box.hasDefault && !hasValue(box.value),
  );
  return missing ? `Enter a value for ${missing.name} to run.` : undefined;
}

/**
 * The `params` of `POST /api/run`: the goal, and a value for each param whose
 * box holds one. An empty box is left out, so the server applies the param's
 * own default, which is what the contract says a run that sends none takes.
 */
export function runParams(goal: string, boxes: readonly ParamBox[]): RunParams {
  // Built as entries, so a name is always an own key of the result and never
  // reaches the prototype of the object sent.
  return Object.fromEntries([
    ['goal', goal],
    ...boxes
      .filter((box) => hasValue(box.value))
      .map((box) => [box.name, box.value] as const),
  ]);
}
