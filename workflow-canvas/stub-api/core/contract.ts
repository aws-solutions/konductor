// SPDX-License-Identifier: Apache-2.0

/** Values that api/openapi.yaml fixes for this version of the API. */
export const API_VERSION = 1;
/** What the session reports. The contract also names `claude` and `fake`. */
export const HARNESS = 'kiro-cli';
export const MAX_TEXT_BYTES = 262_144;
export const MAX_GOAL_CHARS = 2048;
/**
 * The most characters in a param other than the goal: 64 KiB, so a value
 * such as a diff can be passed inline.
 */
export const MAX_PARAM_CHARS = 65_536;
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
/**
 * An output name. It starts with a letter so that a reference can name it and
 * a number such as `{1.5}` stays literal text.
 */
export const OUTPUT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** A param name. It allows `_`, so `diff_input` and `pr_url` fit. */
export const PARAM_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
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
// A reference to a param or an output, as in `{run.goal}` or `{plan.design}`.
// The source is kept as text because the contract compares it with its own
// pattern, and because the scan needs its own global copy.
export const REFERENCE_PATTERN_SOURCE =
  '\\{[a-z0-9][a-z0-9-]*\\.[a-z_][a-z0-9_-]*\\}';
export const REFERENCE_PATTERN = new RegExp(REFERENCE_PATTERN_SOURCE);
/** The name a reference uses for the run's own params, as in `{run.goal}`. */
export const RUN_REFERENCE_SCOPE = 'run';
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

/** An output name is a name that starts with a letter. */
export function isOutputName(value: string): boolean {
  return OUTPUT_NAME_PATTERN.test(value);
}

/** A param name is lower-case words joined by `_`, starting with a letter. */
export function isParamName(value: string): boolean {
  return PARAM_NAME_PATTERN.test(value);
}

/** A stage name must be a name and must not be one of the reserved words. */
export function isUsableStageName(value: string): boolean {
  return isName(value) && !RESERVED_STAGE_NAMES.has(value);
}

/**
 * Whether a value is short and plain enough to echo in a message. A longer
 * value, or one of 12 or more characters with a digit, may be an access key,
 * a token or a hash, and the contract says a message never quotes a value
 * that looks like a secret.
 */
export function isShowable(value: string): boolean {
  const plain = /^[\w.~-]{1,24}$/.test(value);
  const looksSecret = value.length >= 12 && /\d/.test(value);
  return plain && !looksSecret;
}

/** A value in backticks, or `(not shown)` when it may be a secret. */
export function quoteValue(value: string): string {
  return isShowable(value) ? `\`${value}\`` : '(not shown)';
}
