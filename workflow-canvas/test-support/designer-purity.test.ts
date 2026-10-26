// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core of the Designer's editing does no IO and imports no
 * UI: it may import its own modules, the wire types and the scheduler port of
 * the run core, and nothing else. Time and the calls of the API come in
 * through its ports.
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
  dir: fileURLToPath(new URL('../src/designer/core/', import.meta.url)),
  allowedPackages: new Set([
    '../../api/types',
    '../../api/message-of',
    '../../execution/core',
  ]),
  allowedNames: {},
};

describe('the editing core', () => {
  it('has sources to check', () => {
    expect(sourcesUnder(RULES.dir).length).toBeGreaterThanOrEqual(8);
  });

  it('imports only its own modules, the wire types and the scheduler port, and reads no clock, randomness, environment or network', () => {
    expect(problemsUnder(RULES)).toEqual([]);
  });

  it.each([
    ['react', "import { useState } from 'react';"],
    ['the HTTP adapter', "import { createHttpApi } from '../../api/http-api';"],
    [
      'the timer adapter',
      "import { timerScheduler } from '../../execution/timer-scheduler';",
    ],
    ['a Node module', "import { readFileSync } from 'node:fs';"],
  ])('rejects an import of %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });

  it.each([
    ['a timer', 'setTimeout(() => {}, 1000);'],
    ['the clock', 'const now = Date.now();'],
    ['a network call', "await fetch('/api/validate');"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
