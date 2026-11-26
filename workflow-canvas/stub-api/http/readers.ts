// SPDX-License-Identifier: Apache-2.0
import {
  codePointLength,
  isParamName,
  MAX_GOAL_CHARS,
  MAX_PARAM_CHARS,
  quoteValue,
} from '../core/contract.ts';
import { ApiError, badRequest } from '../core/errors.ts';

/** Reads one value of a request body, or throws the error to answer with. */
export type Reader<T> = (value: unknown) => T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const string: Reader<string> = (value) => {
  if (typeof value !== 'string') throw badRequest();
  return value;
};

export const optional =
  <T>(read: Reader<T>): Reader<T | undefined> =>
  (value) =>
    value === undefined ? undefined : read(value);

export const nullable =
  <T>(read: Reader<T>): Reader<T | null> =>
  (value) =>
    value === null ? null : read(value);

/** A string of `min` to `max` code points. */
export const boundedString =
  (min: number, max: number): Reader<string> =>
  (value) => {
    const text = string(value);
    const length = codePointLength(text);
    if (length < min || length > max) throw badRequest();
    return text;
  };

/** An object with exactly the fields of the shape, each read by its reader. */
export function object<T extends object>(shape: {
  [K in keyof T]-?: Reader<T[K]>;
}): Reader<T> {
  return (value) => {
    if (!isRecord(value)) throw badRequest();
    if (Object.keys(value).some((key) => !Object.hasOwn(shape, key))) {
      throw badRequest();
    }
    const read = {} as T;
    for (const key of Object.keys(shape) as (keyof T & string)[]) {
      read[key] = shape[key](value[key]);
    }
    return read;
  };
}

/**
 * The `params` of a run: a `goal` of 1 to 2048 characters, and any other
 * param by name, each of at most 64 KiB. Whether the workflow declares a
 * param is the API's question, not the reader's; this checks only the shape
 * of each value.
 */
const runParams: Reader<Record<string, string>> = (value) => {
  if (!isRecord(value)) throw badRequest();
  const badParams = (message: string) => new ApiError('bad_params', message);
  const { goal, ...others } = value;
  if (goal === undefined) throw badParams('The run needs a goal.');
  const text = paramValue(goal, 'goal', MAX_GOAL_CHARS);
  if (codePointLength(text) < 1) throw badParams('The run needs a goal.');
  const params: Record<string, string> = { goal: text };
  for (const [name, given] of Object.entries(others)) {
    if (!isParamName(name)) {
      throw badParams(`${quoteValue(name)} is not a param name.`);
    }
    params[name] = paramValue(given, name, MAX_PARAM_CHARS);
  }
  return params;
};

// Every param is a string, within the limit for its name.
function paramValue(value: unknown, name: string, max: number): string {
  const text = string(value);
  if (codePointLength(text) > max) {
    throw new ApiError(
      'bad_params',
      `${quoteValue(name)} is longer than ${max} characters.`,
    );
  }
  return text;
}

export const readSessionRequest = object<{ code: string }>({
  code: boundedString(1, 256),
});

export const readSaveRequest = object<{
  name: string | undefined;
  text: string;
  base_hash: string | null;
}>({
  name: optional(string),
  text: string,
  base_hash: nullable(string),
});

export const readCheckRequest = object<{
  name: string | undefined;
  text: string;
}>({
  name: optional(string),
  text: string,
});

export const readRunRequest = object<{ params: Record<string, string> }>({
  params: runParams,
});

/** Reads the requested name of a copied library workflow. */
export const readLibraryCopyRequest = object<{ as: string }>({
  as: string,
});
