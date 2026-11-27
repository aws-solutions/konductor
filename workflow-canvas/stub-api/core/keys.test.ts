// SPDX-License-Identifier: Apache-2.0
/** Checks the key table: one slice per key, and a build that reads up to its own. */
import { describe, expect, it } from 'vitest';
import {
  BUILD_SLICE,
  builtInKeys,
  CHECK_KEYS,
  isBuiltIn,
  isStageKind,
  KEY_TABLES,
  SLICES,
  STAGE_KEYS,
  TOP_KEYS,
} from './keys.ts';

describe('the key table', () => {
  const rules = KEY_TABLES.flatMap((table) =>
    table.keys.map((rule) => ({ path: `${table.prefix}${rule.key}`, ...rule })),
  );

  it('lists a key path once, so a key has one slice', () => {
    const paths = rules.map((rule) => rule.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every key a slice that exists', () => {
    for (const rule of rules) {
      expect(SLICES, rule.path).toContain(rule.slice);
    }
    for (const table of KEY_TABLES) {
      if (table.otherKeys) expect(SLICES).toContain(table.otherKeys);
    }
  });

  it('lists the slices in order, none twice', () => {
    expect(new Set(SLICES).size).toBe(SLICES.length);
    expect(SLICES[0]).toBe('1');
  });

  it('has a build slice that exists', () => {
    expect(SLICES).toContain(BUILD_SLICE);
  });
});

describe('what a build reads', () => {
  it('reads the keys of slices 1, 2 and 3a and no others', () => {
    expect(builtInKeys(TOP_KEYS)).toEqual([
      'format',
      'name',
      'version',
      'intent',
      'params',
      'stages',
    ]);
    expect(builtInKeys(STAGE_KEYS)).toEqual([
      'name',
      'agent',
      'prompt',
      'prompt_file',
      'outcome',
      'outputs',
      'done_when',
    ]);
    expect(builtInKeys(CHECK_KEYS)).toEqual(['id', 'file', 'run']);
  });

  it('puts a slice after another by the order of SLICES', () => {
    expect(isBuiltIn('1')).toBe(true);
    expect(isBuiltIn('2')).toBe(true);
    expect(isBuiltIn('3a')).toBe(true);
    for (const slice of SLICES.slice(3)) {
      expect(isBuiltIn(slice), slice).toBe(false);
    }
  });

  it('knows the keys that name the kind of a stage', () => {
    const kinds = STAGE_KEYS.keys.filter((r) => isStageKind(r.key));
    expect(kinds.map((r) => r.key)).toEqual([
      'agent',
      'run',
      'human_review',
      'human_input',
      'uses',
    ]);
    expect(isStageKind('prompt')).toBe(false);
  });
});
