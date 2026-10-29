// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core does no IO and reads no clock, randomness or
 * environment. It may import its own modules, `yaml` and `createHash`.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  problemsUnder,
  sourcesUnder,
  type PurityRules,
} from '../../test-support/purity.ts';

const RULES: PurityRules = {
  dir: fileURLToPath(new URL('.', import.meta.url)),
  allowedPackages: new Set(['yaml']),
  // A named import is allowed from a module that is otherwise not: the names.
  allowedNames: { 'node:crypto': ['createHash'] },
};

describe('the core', () => {
  it('has sources to check', () => {
    expect(sourcesUnder(RULES.dir).length).toBeGreaterThan(5);
  });

  it('imports only its own modules, yaml and createHash, and reads no clock, randomness, environment or network', () => {
    expect(problemsUnder(RULES)).toEqual([]);
  });
});
