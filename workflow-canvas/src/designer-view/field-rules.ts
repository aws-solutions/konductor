// SPDX-License-Identifier: Apache-2.0

/**
 * One editable key of a stage, the `StageField` of `stage_fields` in
 * `api/openapi.yaml`. It is local until the API client parses it. A rule
 * that is left out does not apply.
 */
export interface StageFieldRule {
  readonly key: string;
  /** `name`, `text` or `path`. A type a later version adds is shown as text. */
  readonly type: string;
  readonly required: boolean;
  readonly min_length?: number;
  readonly max_length?: number;
  /** A regular expression that the whole value matches. */
  readonly pattern?: string;
  /** Values the key may not take. */
  readonly reserved?: readonly string[];
  /** Keys that a stage may not have together with this one. */
  readonly excludes?: readonly string[];
}

/** An agent that a stage may name, as `GET /api/agents` lists it. */
export interface AgentOption {
  readonly id: string;
  readonly summary: string;
}

/**
 * The keys of a stage and their text. A key the stage does not have is not
 * in it, so an empty value never stands for "no key".
 */
export type FieldValues = Readonly<Record<string, string>>;

/** The text of `key`, or `undefined` when the record has no such own key. */
export function textOf(
  record: Readonly<Record<string, string>>,
  key: string,
): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The values with `key` set to `text`, or without `key` when `text` is empty. */
export function withValue(
  values: FieldValues,
  key: string,
  text: string,
): FieldValues {
  if (text !== '') return { ...values, [key]: text };
  return Object.fromEntries(
    Object.entries(values).filter(([other]) => other !== key),
  );
}

// A length counts code points, as the contract says.
function lengthOf(text: string): number {
  return [...text].length;
}

function characters(count: number): string {
  return count === 1 ? '1 character' : `${count} characters`;
}

// A pattern that does not compile is left to the server's check.
function matchesWhole(pattern: string, text: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(text);
  } catch {
    return true;
  }
}

const FORM_OF_TYPE: Readonly<Record<string, string>> = {
  name: 'Use lower-case letters, digits and hyphens, starting with a letter or a digit.',
  path: 'Use a relative path inside the project, with / between its parts.',
};
const OTHER_FORM = 'The value is not of the form this key takes.';

function otherKeySet(
  rule: StageFieldRule,
  values: FieldValues,
): string | undefined {
  return rule.excludes?.find((other) => Object.hasOwn(values, other));
}

/**
 * What is wrong with the value of one key, or `undefined` when nothing is.
 * Only the first rule it breaks is said: required, then reserved, the
 * lengths, the pattern, and the keys it excludes.
 */
export function fieldError(
  rule: StageFieldRule,
  values: FieldValues,
): string | undefined {
  const text = textOf(values, rule.key);
  if (text === undefined) {
    return rule.required ? 'A stage needs this key.' : undefined;
  }
  if (rule.reserved?.includes(text)) return `${text} is reserved.`;
  const length = lengthOf(text);
  if (rule.min_length !== undefined && length < rule.min_length) {
    return `Use at least ${characters(rule.min_length)}.`;
  }
  if (rule.max_length !== undefined && length > rule.max_length) {
    return `Use at most ${characters(rule.max_length)}.`;
  }
  if (rule.pattern !== undefined && !matchesWhole(rule.pattern, text)) {
    return textOf(FORM_OF_TYPE, rule.type) ?? OTHER_FORM;
  }
  const other = otherKeySet(rule, values);
  return other === undefined
    ? undefined
    : `Use ${rule.key} or ${other}, not both.`;
}

/** The error of each key that has one. */
export function fieldErrors(
  rules: readonly StageFieldRule[],
  values: FieldValues,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    rules.flatMap((rule) => {
      const error = fieldError(rule, values);
      return error === undefined ? [] : [[rule.key, error]];
    }),
  );
}

/** The line under a key that says what it takes. */
export function fieldHint(rule: StageFieldRule): string {
  const parts = [rule.required ? 'Required.' : 'Optional.'];
  if (rule.min_length !== undefined && rule.min_length > 1) {
    parts.push(`At least ${characters(rule.min_length)}.`);
  }
  if (rule.max_length !== undefined) {
    parts.push(`At most ${characters(rule.max_length)}.`);
  }
  if (rule.excludes?.length) {
    parts.push(`Not with ${rule.excludes.join(' or ')}.`);
  }
  return parts.join(' ');
}

/**
 * The agents to offer: those of the list, with the stage's `original` agent
 * and its `current` one first when the list does not have them, each once.
 * `original` is the agent the stage had when it was loaded, so a person who
 * picks another agent can still pick it again.
 */
export function agentOptions(
  agents: readonly AgentOption[],
  current: string | undefined,
  original?: string,
): readonly AgentOption[] {
  const listed = new Set(agents.map((agent) => agent.id));
  const extra = [...new Set([original, current])].filter(
    (id): id is string => id !== undefined && !listed.has(id),
  );
  if (extra.length === 0) return agents;
  return [
    ...extra.map((id) => ({ id, summary: 'Not in the list of agents.' })),
    ...agents,
  ];
}
