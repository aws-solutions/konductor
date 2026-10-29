// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the graph core does no IO and imports no UI, so it can be
 * tested and reused without a browser. It may import only its own modules.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  problemsIn,
  problemsUnder,
  sourcesUnder,
  type PurityRules,
} from './purity.ts';

const RULES: PurityRules = {
  dir: fileURLToPath(new URL('../src/graph/', import.meta.url)),
  allowedPackages: new Set(),
  allowedNames: {},
};

describe('the graph core', () => {
  it('has sources to check', () => {
    expect(sourcesUnder(RULES.dir).length).toBeGreaterThanOrEqual(3);
  });

  it('imports only its own modules and reads no clock, randomness, environment or network', () => {
    expect(problemsUnder(RULES)).toEqual([]);
  });

  it.each([
    ['react', "import { useState } from 'react';"],
    ['the flow library', "import { Position } from '@xyflow/react';"],
    ['a module above the core', "import { x } from '../api/client';"],
    ['a Node module', "import { readFileSync } from 'node:fs';"],
  ])('rejects an import of %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
