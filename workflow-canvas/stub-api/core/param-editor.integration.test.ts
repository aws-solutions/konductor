// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { HELLO_DOCUMENT, HELLO_VIEW } from '../../src/test-support/fixtures.ts';
import { reduce } from '../../src/designer/core/edit-reducer.ts';
import {
  canSave,
  fileBlocker,
  isDirty,
  paramsBlocker,
  textOf,
  writeBlocker,
} from '../../src/designer/core/edit-view.ts';
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
  intent: { outcome: 'Add a greeting' },
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
    expect(state.paramBases).toEqual(['p1']);
    expect(state.saved.view.params).toHaveProperty('param_1');
  });

  it('saves a stage rename beside flow-style params without changing them', () => {
    const text = [
      'format: konductor/1',
      'name: hello',
      'version: 0.1.0',
      'intent:',
      '  outcome: Add a greeting',
      'params: { goal: {} }',
      'stages:',
      '  - name: draft',
      '    agent: k-developer',
      '',
    ].join('\n');
    const opened = checkWorkflowText(text, 'hello');
    expect(opened.errors).toBe(0);
    let state = reduce(undefined, {
      type: 'open',
      document: { ...HELLO_DOCUMENT, text, view: opened.view! },
    })!;

    state = reduce(state, { type: 'rename', id: 's1', name: 'write' })!;
    const written = textOf(state)!;
    expect(fileBlocker(state)).toBeUndefined();
    expect(written).toContain('params: { goal: {} }');
    const checked = checkWorkflowText(written, 'hello');
    expect(checked.errors).toBe(0);
    state = reduce(state, {
      type: 'checked',
      revision: state.revision,
      diagnostics: checked.diagnostics,
    })!;
    expect(canSave(state)).toBe(true);
    state = reduce(state, { type: 'save' })!;
    state = reduce(state, {
      type: 'saved',
      text: written,
      result: {
        hash: 'c'.repeat(64),
        view: checked.view!,
        diagnostics: checked.diagnostics,
      },
    })!;

    expect(isDirty(state)).toBe(false);
    expect(state.saved.text).toContain('params: { goal: {} }');
  });

  it('opens and saves explicit empty strings without staying dirty', () => {
    const text = [
      'format: konductor/1',
      'name: hello',
      'version: 0.1.0',
      'intent:',
      '  outcome: Add a greeting',
      'params:',
      '  goal:',
      "    description: ''",
      "    default: ''",
      'stages:',
      '  - name: draft',
      '    agent: k-developer',
      '',
    ].join('\n');
    const opened = checkWorkflowText(text, 'hello');
    expect(opened.errors).toBe(0);
    let state = reduce(undefined, {
      type: 'open',
      document: { ...HELLO_DOCUMENT, text, view: opened.view! },
    })!;
    expect(isDirty(state)).toBe(false);

    state = reduce(state, { type: 'rename', id: 's1', name: 'write' })!;
    const written = textOf(state)!;
    const checked = checkWorkflowText(written, 'hello');
    expect(checked.errors).toBe(0);
    state = reduce(state, {
      type: 'checked',
      revision: state.revision,
      diagnostics: checked.diagnostics,
    })!;
    state = reduce(state, { type: 'save' })!;
    state = reduce(state, {
      type: 'saved',
      text: written,
      result: {
        hash: 'd'.repeat(64),
        view: checked.view!,
        diagnostics: checked.diagnostics,
      },
    })!;

    expect(isDirty(state)).toBe(false);
    expect(state.saved.view.params?.goal).toMatchObject({
      description: '',
      default: '',
    });
  });

  it('does not emit an untouched synthesized goal with another param edit', () => {
    const text = [
      'format: konductor/1',
      'name: hello',
      'version: 0.1.0',
      'intent:',
      '  outcome: Add a greeting',
      'params:',
      '  topic: {}',
      'stages:',
      '  - name: draft',
      '    agent: k-developer',
      '',
    ].join('\n');
    const opened = checkWorkflowText(text, 'hello');
    let state = reduce(undefined, {
      type: 'open',
      document: { ...HELLO_DOCUMENT, text, view: opened.view! },
    })!;
    const topic = state.draft.params.find((param) => param.name === 'topic')!;

    state = reduce(state, {
      type: 'set-param',
      id: topic.id,
      change: { description: 'Reader' },
    })!;

    expect(textOf(state)).toBe(
      text.replace('  topic: {}\n', '  topic: \n    description: Reader\n'),
    );
  });

  it('returns a write blocker for a YAML-shaped parameter name', () => {
    const text =
      'format: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Add a greeting\nparams:\n  old: {}\nstages:\n  - name: draft\n    agent: k-developer\n';
    const opened = checkWorkflowText(text, 'hello');
    let state = reduce(undefined, {
      type: 'open',
      document: { ...HELLO_DOCUMENT, text, view: opened.view! },
    })!;
    const old = state.draft.params.find((param) => param.name === 'old')!;

    state = reduce(state, {
      type: 'set-param',
      id: old.id,
      change: {
        name: 'topic: {description: injected, required: true} #',
      },
    })!;

    expect(writeBlocker(state)).toBe(
      'A parameter name must start with a lowercase letter and contain only lowercase letters, digits or underscores, up to 64 characters.',
    );
    expect(textOf(state)).toBeUndefined();
  });

  it.each([
    [
      'a BOM-prefixed empty mapping',
      '\uFEFFparams: {}\nformat: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Add a greeting\nstages:\n  - name: draft\n    agent: k-developer\n',
    ],
    [
      'an explicit-key empty mapping',
      '? params\n: {}\nformat: konductor/1\nname: hello\nversion: 0.1.0\nintent:\n  outcome: Add a greeting\nstages:\n  - name: draft\n    agent: k-developer\n',
    ],
  ])(
    'refuses a params edit beside %s without adding another mapping',
    (_name, text) => {
      const checked = checkWorkflowText(text, 'hello');
      expect(checked.errors).toBe(0);
      let state = reduce(undefined, {
        type: 'open',
        document: { ...HELLO_DOCUMENT, text, view: checked.view! },
      })!;
      expect(paramsBlocker(state)).toBeDefined();

      state = reduce(state, {
        type: 'set-param',
        id: 'p-goal',
        change: { description: 'Run it' },
      })!;
      expect(textOf(state)).toBeUndefined();
    },
  );
});
