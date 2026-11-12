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
/** Mappings and lists nested inside one another, the root counting as level 1. */
export const MAX_YAML_DEPTH = 32;
/** What the session reports as `konductor_version`: the stub is no release. */
export const KONDUCTOR_VERSION = '0.0.0-stub';
/** The limits that the session reports, by their names in the contract. */
export const SESSION_LIMITS = {
  text_bytes: MAX_TEXT_BYTES,
  stages: MAX_STAGES,
  outcome_chars: MAX_INTENT_CHARS,
  prompt_chars: MAX_PROMPT_CHARS,
  goal_chars: MAX_GOAL_CHARS,
} as const;
export const FORMAT = 'konductor/1';
/** The version the check suggests when `version` is not a semantic version. */
export const SUGGESTED_VERSION = '0.1.0';

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Three whole numbers without leading zeros.
export const VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
// The path rule of the specification: segments joined by `/`, none of them empty,
// `.` or `..`, no `\`, no control character (U+0000 to U+001F, U+007F to U+009F),
// no leading `/` and no leading drive letter and colon. The source is kept as
// text because the contract compares it with its own pattern.
export const PATH_PATTERN_SOURCE =
  '^(?![A-Za-z]:)(?!/)(?:(?!\\.{1,2}(?:/|$))[^\\\\/\\x00-\\x1f\\x7f-\\x9f]+)(?:/(?!\\.{1,2}(?:/|$))[^\\\\/\\x00-\\x1f\\x7f-\\x9f]+)*$';
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
