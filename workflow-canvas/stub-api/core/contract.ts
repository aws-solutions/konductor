// SPDX-License-Identifier: Apache-2.0

/** Values that api/openapi.yaml fixes for this version of the API. */
export const API_VERSION = 1;
export const HARNESS = 'kiro-cli';
export const MAX_TEXT_BYTES = 262_144;
export const MAX_GOAL_CHARS = 2048;
export const MAX_INTENT_CHARS = 300;
export const MAX_STAGES = 40;

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;
export const RUN_ID_PATTERN = /^[0-9]{8}-[0-9]{4}-[a-z0-9]{5}$/;
export const RESERVED_STAGE_NAMES: ReadonlySet<string> = new Set([
  'start',
  'end',
  'run',
  'halt',
]);

/** The length of a text in code points, which is how the contract counts. */
export function codePointLength(text: string): number {
  return [...text].length;
}

/** A workflow name, stage name or agent id is lower-case words with hyphens. */
export function isName(value: string): boolean {
  return NAME_PATTERN.test(value);
}

/** A stage name must be a name and must not be one of the reserved words. */
export function isUsableStageName(value: string): boolean {
  return isName(value) && !RESERVED_STAGE_NAMES.has(value);
}
