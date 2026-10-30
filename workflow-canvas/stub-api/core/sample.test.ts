// SPDX-License-Identifier: Apache-2.0
/** Checks the workflows that the stub can serve. */
import { describe, expect, it } from 'vitest';
import { STAGE_REASONS } from './model.ts';
import { FIXTURES, SAMPLE_FILES, SAMPLE_ROOT } from './sample.ts';
import { checkWorkflowText } from './validator.ts';

describe('the fixtures', () => {
  it('include the root of the session', () => {
    expect(FIXTURES).toHaveProperty(SAMPLE_ROOT);
    expect(FIXTURES[SAMPLE_ROOT]?.behavior).toEqual({});
  });

  it.each(Object.entries(FIXTURES))(
    'has %s, a valid workflow that is named for itself',
    (name, fixture) => {
      const check = checkWorkflowText(fixture.text, name);
      expect(check.diagnostics).toEqual([]);
      expect(check.view?.name).toBe(name);
      expect(SAMPLE_FILES[name]).toBe(fixture.text);
    },
  );

  it('show a workflow that needs trust, a blocked stage and a busy workspace', () => {
    expect(FIXTURES['untrusted']?.behavior).toEqual({ untrusted: true });
    expect(FIXTURES['busy']?.behavior).toEqual({ busy: true });
    const blocks = FIXTURES['blocked']?.behavior.blocks;
    expect(STAGE_REASONS).toContain(blocks?.reason);
  });

  it('give the blocked workflow a stage after the blocked one', () => {
    const blocks = FIXTURES['blocked']?.behavior.blocks;
    const stages = checkWorkflowText(FIXTURES['blocked']?.text ?? '', 'blocked')
      .view?.stages;
    expect(stages?.length).toBeGreaterThan((blocks?.stage ?? 0) + 1);
  });
});
