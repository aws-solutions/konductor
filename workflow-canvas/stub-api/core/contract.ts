// SPDX-License-Identifier: Apache-2.0

/** Values that api/openapi.yaml fixes for this version of the API. */
export const API_VERSION = 1;
/** What the session reports. The contract also names `claude` and `fake`. */
export const HARNESS = 'kiro-cli';
export const MAX_TEXT_BYTES = 262_144;
export const MAX_GOAL_CHARS = 2048;
export const MAX_INTENT_CHARS = 300;
export const MAX_PROMPT_CHARS = 32_768;
export const MAX_STAGES = 40;
export const FORMAT = 'konductor/1';
/** The version the check suggests when `version` is not a semantic version. */
export const SUGGESTED_VERSION = '0.1.0';

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Three whole numbers without leading zeros.
export const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
// A path is one line, is not absolute and has no `..` segment. The source is
// kept as text because the contract compares it with its own pattern.
export const PATH_PATTERN_SOURCE = '^(?!/)(?!(?:.*/)?\\.\\.(?:/|$)).+$';
export const PATH_PATTERN = new RegExp(PATH_PATTERN_SOURCE);
// A reference to a param or an output, which slice 2 gives a meaning.
export const REFERENCE_PATTERN = /\{[a-z0-9][a-z0-9-]*\.[a-z_][a-z0-9_-]*\}/;
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
