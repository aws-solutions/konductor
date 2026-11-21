// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core of the Run view does no IO: the start call, the reads
 * of a run and the clock all come in through the view that drives it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { problemsIn, type PurityRules } from './purity.ts';

const DIR = new URL('../src/run-view/', import.meta.url);

const RULES: PurityRules = {
  dir: fileURLToPath(DIR),
  allowedPackages: new Set([
    '../execution/core/run-history',
    '../execution/core/run-progress',
    '../execution/core/timestamp',
  ]),
  allowedNames: {},
};

const CORE = ['run-start.ts', 'run-timing.ts'];

describe('the core of the Run view', () => {
  it.each(CORE)(
    '%s reads no clock, randomness, environment or network',
    (file) => {
      const source = readFileSync(new URL(file, DIR), 'utf8');

      expect(problemsIn(file, source, RULES)).toEqual([]);
    },
  );

  it.each([
    ['react', "import { useState } from 'react';"],
    ['a timer', 'setTimeout(() => {}, 400);'],
    ['a network call', "await fetch('/api/run');"],
    ['the page', 'document.title = "x";'],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
