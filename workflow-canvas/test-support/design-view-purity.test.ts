// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that the core of the Design view does no IO: it reads the stage of
 * a check answer, the draft of the editor and the findings to show, and
 * nothing else. The shapes it names are types only, so none of them is there
 * when the page runs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { problemsIn, type PurityRules } from './purity.ts';

const DIR = new URL('../src/design-view/', import.meta.url);

const RULES: PurityRules = {
  dir: fileURLToPath(DIR),
  allowedPackages: new Set([
    '../designer/core/draft',
    '../designer-view/yaml-draft',
    '../designer-view/YamlPane',
    '../designer-view/field-rules',
  ]),
  allowedNames: {},
};

const CORE = ['view-stage.ts', 'findings.ts'];

describe('the core of the Design view', () => {
  it.each(CORE)(
    '%s imports nothing but the shapes it names, and reads no clock or network',
    (file) => {
      const source = readFileSync(new URL(file, DIR), 'utf8');

      expect(problemsIn(file, source, RULES)).toEqual([]);
    },
  );

  it.each([
    ['react', "import { useState } from 'react';"],
    ['a network call', "await fetch('/api/validate');"],
    ['the page', 'document.title = "x";'],
    ['a timer', 'setTimeout(() => {}, 400);'],
  ])('rejects %s', (_, line) => {
    expect(problemsIn('x.ts', line, RULES)).not.toEqual([]);
  });
});
