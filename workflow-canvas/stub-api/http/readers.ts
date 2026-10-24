// SPDX-License-Identifier: Apache-2.0
import { MAX_GOAL_CHARS } from '../core/contract.ts';
import { ApiError } from '../core/errors.ts';

/** Reads one value of a request body, or throws the error to answer with. */
export type Reader<T> = (value: unknown) => T;

const badRequest = () =>
  new ApiError('bad_request', 'The request body is not valid.');

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
    const length = [...text].length;
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

/** The `params` of a run: only a `goal`, which must be 1 to 2048 characters. */
const runParams: Reader<{ goal: string }> = (value) => {
  if (!isRecord(value)) throw badRequest();
  const { goal, ...others } = value;
  const badParams = (message: string) => new ApiError('bad_params', message);
  if (Object.keys(others).length > 0)
    throw badParams('Only a goal is allowed.');
  if (goal === undefined) throw badParams('The run needs a goal.');
  const text = string(goal);
  const length = [...text].length;
  if (length < 1) throw badParams('The run needs a goal.');
  if (length > MAX_GOAL_CHARS) {
    throw badParams(`The goal is longer than ${MAX_GOAL_CHARS} characters.`);
  }
  return { goal: text };
};

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

export const readRunRequest = object<{ params: { goal: string } }>({
  params: runParams,
});
