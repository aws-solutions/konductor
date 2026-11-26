// SPDX-License-Identifier: Apache-2.0
/** Checks how references are read out of a text and placed in its source. */
import { describe, expect, it } from 'vitest';
import { isRunReference, offsetInSource, referencesIn } from './references.ts';

describe('referencesIn', () => {
  it('reads the scope, the name and where each one starts', () => {
    expect(referencesIn('Write {run.topic} to {plan.design}.')).toEqual([
      { scope: 'run', name: 'topic', text: '{run.topic}', at: 6 },
      { scope: 'plan', name: 'design', text: '{plan.design}', at: 21 },
    ]);
  });

  it.each([
    ['a number', 'Report {1.5} please'],
    ['a JSON shape', 'Send {severity, file, line}'],
    ['a brace on its own', 'Use { and } alone'],
    ['an upper-case name', 'Read {run.Topic}'],
    ['a name with no dot', 'Read {runtopic}'],
    ['a scope that starts with a hyphen', 'Read {-run.topic}'],
  ])('leaves %s alone', (_, text) => {
    expect(referencesIn(text)).toEqual([]);
  });

  it('reads a name with an underscore and one with a hyphen', () => {
    const found = referencesIn('{run.diff_input} {plan.design-notes}');
    expect(found.map((one) => one.name)).toEqual([
      'diff_input',
      'design-notes',
    ]);
  });

  it('knows a param of the run from an output of a stage', () => {
    const [param, output] = referencesIn('{run.goal} {run-up.goal}');
    expect(isRunReference(param!)).toBe(true);
    expect(isRunReference(output!)).toBe(false);
  });
});

describe('offsetInSource', () => {
  const reference = referencesIn('{a.b}')[0]!;

  it('finds the first one, then the next one of the same text', () => {
    const source = '"{a.b} and {a.b}"';
    expect(offsetInSource(source, reference, 0)).toBe(1);
    expect(offsetInSource(source, reference, 1)).toBe(11);
  });

  it('has no offset for a reference the source does not spell out', () => {
    expect(offsetInSource('"\\x7ba.b}"', reference, 0)).toBeUndefined();
    expect(offsetInSource('"{a.b}"', reference, 1)).toBeUndefined();
  });
});
