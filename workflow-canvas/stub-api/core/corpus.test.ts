// SPDX-License-Identifier: Apache-2.0
/**
 * The shared conformance corpus: every `.yml` in `api/corpus/` is checked, and
 * the result must equal the `.json` next to it. The Rust loader's tests read
 * the same folder, so the two loaders cannot drift. The message of a
 * diagnostic is prose, and each loader words it its own way, so it is left
 * out of the comparison.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWorkflowText } from './validator.ts';

const DIR = fileURLToPath(new URL('../../api/corpus/', import.meta.url));
const cases = readdirSync(DIR)
  .filter((file) => file.endsWith('.yml'))
  .map((file) => file.slice(0, -'.yml'.length))
  .sort();

function comparable(result: ReturnType<typeof checkWorkflowText>) {
  return {
    errors: result.errors,
    view: result.view,
    diagnostics: result.diagnostics.map((d) => {
      const rest: Record<string, unknown> = { ...d };
      delete rest.message;
      return rest;
    }),
  };
}

describe('the shared corpus', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases)('gives the expected result for %s', (name) => {
    const text = readFileSync(`${DIR}${name}.yml`, 'utf8');
    const expected = JSON.parse(readFileSync(`${DIR}${name}.json`, 'utf8'));
    expect(comparable(checkWorkflowText(text, name))).toEqual(expected);
  });
});
