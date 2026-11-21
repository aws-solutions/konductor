// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the reducer of the YAML draft does no IO and imports nothing:
 * the check and the clock come in through the hook that drives it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { problemsIn, type PurityRules } from './purity.ts';

const FILE = new URL('../src/designer-view/yaml-draft.ts', import.meta.url);

const RULES: PurityRules = {
  dir: fileURLToPath(new URL('../src/designer-view/', import.meta.url)),
  allowedPackages: new Set(),
  allowedNames: {},
};

describe('the YAML draft reducer', () => {
  it('imports nothing and reads no clock, randomness, environment or network', () => {
    expect(
      problemsIn('yaml-draft.ts', readFileSync(FILE, 'utf8'), RULES),
    ).toEqual([]);
  });

  it.each([
    ['react', "import { useState } from 'react';"],
    ['a timer', 'setTimeout(() => {}, 400);'],
    ['a network call', "await fetch('/api/validate');"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
