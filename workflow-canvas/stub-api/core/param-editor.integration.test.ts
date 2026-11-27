// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT, HELLO_VIEW } from '../../src/test-support/fixtures.ts';
import { reduce } from '../../src/designer/core/edit-reducer.ts';
import { isDirty, textOf } from '../../src/designer/core/edit-view.ts';
import { checkWorkflowText } from './validator.ts';

const TEXT = [
  'format: konductor/1',
  'name: hello',
  'version: 0.1.0',
  'intent:',
  '  outcome: Add a greeting',
  'stages:',
  '  - name: draft',
  '    agent: k-developer',
  '',
].join('\n');

const VIEW = {
  ...HELLO_VIEW,
  params: undefined,
  stages: [
    {
      ...HELLO_VIEW.stages[0]!,
      range: { line: 7, end_line: 8 },
    },
  ],
};

describe('parameter editing through check and save', () => {
  it('adds a valid param without renaming it, checks cleanly and saves', () => {
    let state = reduce(undefined, {
      type: 'open',
      document: { ...HELLO_DOCUMENT, text: TEXT, view: VIEW },
    })!;
    expect(isDirty(state)).toBe(false);
    expect(state.draft.params[0]).toMatchObject({
      id: 'p-goal',
      isGoal: true,
      name: 'goal',
    });

    state = reduce(state, { type: 'add-param' })!;
    const text = textOf(state)!;

    expect(text).toContain('  param_1: {}');
    const checked = checkWorkflowText(text, 'hello');
    expect(checked.errors).toBe(0);
    expect(checked.view?.params).toHaveProperty('param_1');

    state = reduce(state, {
      type: 'checked',
      revision: state.revision,
      diagnostics: checked.diagnostics,
    })!;
    state = reduce(state, { type: 'save' })!;
    state = reduce(state, {
      type: 'saved',
      text,
      result: {
        hash: 'b'.repeat(64),
        view: checked.view!,
        diagnostics: checked.diagnostics,
      },
    })!;

    expect(isDirty(state)).toBe(false);
    expect(state.paramBases).toEqual(['p-goal', 'p1']);
    expect(state.saved.view.params).toHaveProperty('param_1');
  });
});
