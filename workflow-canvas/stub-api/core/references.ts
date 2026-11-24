// SPDX-License-Identifier: Apache-2.0
import { REFERENCE_PATTERN_SOURCE, RUN_REFERENCE_SCOPE } from './contract.ts';

/** One reference in a prompt, as the author wrote it. */
export interface Reference {
  /** `run` for a param of the run, or the name of a stage. */
  scope: string;
  /** The param or output the reference names. */
  name: string;
  /** The reference as it is written, braces included. */
  text: string;
  /** Where it starts in the text it was read from. */
  at: number;
}

const ALL_REFERENCES = new RegExp(REFERENCE_PATTERN_SOURCE, 'g');

/**
 * Every reference in a text, in the order they appear. Text that does not
 * match the pattern is left alone, so a JSON shape such as
 * `{severity, file, line}` and a number such as `{1.5}` are not references.
 */
export function referencesIn(text: string): Reference[] {
  return [...text.matchAll(ALL_REFERENCES)].map((match) => {
    const whole = match[0];
    const dot = whole.indexOf('.');
    return {
      scope: whole.slice(1, dot),
      name: whole.slice(dot + 1, -1),
      text: whole,
      at: match.index,
    };
  });
}

/** Whether a reference names a param of the run rather than a stage. */
export function isRunReference(reference: Reference): boolean {
  return reference.scope === RUN_REFERENCE_SCOPE;
}

/**
 * Where to report a reference inside the source of the value it was read
 * from. A parsed prompt is not always its source, since a quoted scalar may
 * escape characters, so the reference is looked for by its own text, taking
 * the `skip`th one of its kind. Without a match the caller falls back to the
 * whole value, which `undefined` asks for.
 */
export function offsetInSource(
  source: string,
  reference: Reference,
  skip: number,
): number | undefined {
  let found = -1;
  for (let seen = 0; seen <= skip; seen += 1) {
    found = source.indexOf(reference.text, found + 1);
    if (found === -1) return undefined;
  }
  return found;
}
