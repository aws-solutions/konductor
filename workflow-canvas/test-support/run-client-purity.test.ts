// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the run client does no IO of its own: the network and the clock
 * come in through its ports. It may import its own modules, the run core's
 * reducer and scheduler port, and the retry rule of the API client.
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
  dir: fileURLToPath(new URL('../src/run-client/', import.meta.url)),
  allowedPackages: new Set([
    '../execution/core/run-follow',
    '../execution/core/ports',
  ]),
  allowedNames: { '../api/api': ['canRetryStatus'] },
};

describe('the run client', () => {
  it('has sources to check', () => {
    expect(sourcesUnder(RULES.dir).length).toBeGreaterThanOrEqual(2);
  });

  it('imports only its own modules, the run core and the retry rule, and reads no clock, randomness, environment or network', () => {
    expect(problemsUnder(RULES)).toEqual([]);
  });

  it.each([
    ['react', "import { useState } from 'react';"],
    ['the HTTP adapter', "import { createHttpApi } from '../api/http-api';"],
    ['the API error', "import { ApiError } from '../api/api';"],
    [
      'the timer adapter',
      "import { timerScheduler } from '../execution/timer-scheduler';",
    ],
  ])('rejects an import of %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });

  it.each([
    ['a timer', 'setTimeout(() => {}, 1000);'],
    ['the clock', 'const now = Date.now();'],
    ['a network call', "await fetch('/api/runs/r/events');"],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
