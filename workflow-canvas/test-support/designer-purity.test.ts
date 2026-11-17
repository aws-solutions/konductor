// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core of the Designer's editing does no IO and imports no
 * UI: it may import its own modules, the wire types, the message helper of
 * the API client and the scheduler port of the run core, and nothing else.
 * The one exception is `yaml`, which only the module that finds the ranges of
 * the prompts may import. Time and the calls of the API come in through its
 * ports.
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
  allowedPackagesIn: { 'prompt-spots.ts': new Set(['yaml']) },
  allowedNames: {},
};

describe('the editing core', () => {
  it('has sources to check', () => {
    expect(sourcesUnder(RULES.dir).length).toBeGreaterThanOrEqual(8);
  });

  it('imports only its own modules, the wire types, the message helper and the scheduler port, and reads no clock, randomness, environment or network', () => {
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
    ['a package other than yaml', "import { parse } from 'jsonc-parser';"],
  ])('rejects an import of %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
    expect(problemsIn('prompt-spots.ts', line, RULES)).not.toEqual([]);
  });

  it('lets only the module that finds the ranges of the prompts import yaml', () => {
    const line = "import { parseDocument } from 'yaml';";

    expect(problemsIn('prompt-spots.ts', line, RULES)).toEqual([]);
    expect(problemsIn('prompt-text.ts', line, RULES)).not.toEqual([]);
    expect(problemsIn('sub/prompt-spots.ts', line, RULES)).not.toEqual([]);
  });

  it('still rejects the clock and the network in the module that imports yaml', () => {
    const source = "import { parseDocument } from 'yaml';\nDate.now();";

    expect(problemsIn('prompt-spots.ts', source, RULES)).not.toEqual([]);
  });

  it.each([
    ['a timer', 'setTimeout(() => {}, 1000);'],
    ['the clock', 'const now = Date.now();'],
    ['a network call', "await fetch('/api/validate');"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
