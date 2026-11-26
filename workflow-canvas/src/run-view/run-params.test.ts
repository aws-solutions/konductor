// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { ParamDeclaration } from '../api/workflow-extras';
import {
  declaredParamsOf,
  keptParams,
  PARAM_MAX_LENGTH,
  PARAMS_LOADING,
  paramsUnknownProblem,
  paramBoxes,
  paramProblem,
  paramsProblem,
  runParams,
  withParam,
} from './run-params';

const DIFF: ParamDeclaration = {
  name: 'diff_input',
  type: 'string',
  description: 'The diff to read.',
  required: true,
};

const BRANCH: ParamDeclaration = {
  name: 'branch',
  default: 'main',
  required: false,
};

describe('paramBoxes', () => {
  it('draws a box per declared param, in the order given', () => {
    const boxes = paramBoxes([DIFF, BRANCH], {});

    expect(boxes.map((box) => box.name)).toEqual(['diff_input', 'branch']);
  });

  it('prefills the declared default', () => {
    const [box] = paramBoxes([BRANCH], {});

    expect(box?.value).toBe('main');
  });

  it('is empty for a param with no default', () => {
    const [box] = paramBoxes([DIFF], {});

    expect(box?.value).toBe('');
  });

  it('shows what was typed over the default', () => {
    const [box] = paramBoxes([BRANCH], { branch: 'release' });

    expect(box?.value).toBe('release');
  });

  it('leaves a box the person emptied empty', () => {
    const [box] = paramBoxes([BRANCH], { branch: '' });

    expect(box?.value).toBe('');
  });

  it('carries the description and whether a value is needed', () => {
    const [box] = paramBoxes([DIFF], {});

    expect(box?.description).toBe('The diff to read.');
    expect(box?.required).toBe(true);
  });

  it('says whether the workflow declares a default for it', () => {
    expect(paramBoxes([BRANCH], {})[0]?.hasDefault).toBe(true);
    expect(paramBoxes([DIFF], {})[0]?.hasDefault).toBe(false);
  });

  it('counts an empty declared default as a default', () => {
    const [box] = paramBoxes(
      [{ name: 'note', default: '', required: true }],
      {},
    );

    expect(box?.hasDefault).toBe(true);
  });

  it('reads a typed text as an own key only', () => {
    const [box] = paramBoxes([{ name: 'constructor', required: false }], {});

    expect(box?.value).toBe('');
  });

  it('marks a value that is over the limit', () => {
    const long = 'a'.repeat(PARAM_MAX_LENGTH + 1);

    const [box] = paramBoxes([BRANCH], { branch: long });

    expect(box?.problem).toContain(`${PARAM_MAX_LENGTH} characters`);
  });
});

describe('paramProblem', () => {
  it('takes a value at the limit', () => {
    expect(paramProblem('a'.repeat(PARAM_MAX_LENGTH))).toBeUndefined();
  });

  it('counts characters, not the units of a string', () => {
    expect(paramProblem('😀'.repeat(PARAM_MAX_LENGTH))).toBeUndefined();
    expect(paramProblem('😀'.repeat(PARAM_MAX_LENGTH + 1))).toBeDefined();
  });
});

describe('paramsProblem', () => {
  it('says nothing when every box is one the API takes', () => {
    expect(paramsProblem(paramBoxes([BRANCH], {}))).toBeUndefined();
  });

  it('names a required param with no value and no default', () => {
    expect(paramsProblem(paramBoxes([DIFF], {}))).toBe(
      'Enter a value for diff_input to run.',
    );
  });

  it('takes a required param that has a default', () => {
    expect(
      paramsProblem(paramBoxes([{ ...BRANCH, required: true }], {})),
    ).toBeUndefined();
  });

  it('takes white space as a value, as the API does', () => {
    expect(
      paramsProblem(paramBoxes([DIFF], { diff_input: '   ' })),
    ).toBeUndefined();
  });

  it('takes a required param whose box was cleared back to its default', () => {
    const cleared = paramBoxes([{ ...BRANCH, required: true }], {
      branch: '',
    });

    expect(paramsProblem(cleared)).toBeUndefined();
  });

  it('names a value that is too long before a missing one', () => {
    const boxes = paramBoxes([DIFF, BRANCH], {
      branch: 'a'.repeat(PARAM_MAX_LENGTH + 1),
    });

    expect(paramsProblem(boxes)).toContain('branch');
  });
});

describe('runParams', () => {
  it('sends the goal with the values in the boxes', () => {
    const boxes = paramBoxes([DIFF, BRANCH], { diff_input: 'the.diff' });

    expect(runParams('Add a greeting', boxes)).toEqual({
      goal: 'Add a greeting',
      diff_input: 'the.diff',
      branch: 'main',
    });
  });

  it('leaves an empty box out, so the server applies the default', () => {
    const boxes = paramBoxes([BRANCH], { branch: '' });

    expect(runParams('Add a greeting', boxes)).toEqual({
      goal: 'Add a greeting',
    });
  });

  it('omits the key of a required param cleared back to its default', () => {
    const boxes = paramBoxes([{ ...BRANCH, required: true }], { branch: '' });

    expect(runParams('Add a greeting', boxes)).toEqual({
      goal: 'Add a greeting',
    });
  });

  it('sends a value of white space as it was typed', () => {
    const boxes = paramBoxes([DIFF], { diff_input: '   ' });

    expect(runParams('Add a greeting', boxes)).toEqual({
      goal: 'Add a greeting',
      diff_input: '   ',
    });
  });

  it('keeps the spaces around a value', () => {
    const boxes = paramBoxes([DIFF], { diff_input: '  the.diff  ' });

    expect(runParams('Add a greeting', boxes)).toEqual({
      goal: 'Add a greeting',
      diff_input: '  the.diff  ',
    });
  });

  it('sends only the goal when the workflow declares nothing else', () => {
    expect(runParams('Add a greeting', [])).toEqual({ goal: 'Add a greeting' });
  });
});

describe('withParam', () => {
  it('puts a text in beside the ones already typed', () => {
    expect(withParam({ branch: 'main' }, 'diff_input', 'the.diff')).toEqual({
      branch: 'main',
      diff_input: 'the.diff',
    });
  });

  it('keeps a name as an own key, never the prototype', () => {
    const typed = withParam({}, '__proto__', 'x');

    expect(Object.hasOwn(typed, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(typed)).toBe(Object.prototype);
  });
});

describe('the state of the declared params', () => {
  it('has the declarations once they are read', () => {
    const state = { kind: 'ready', declared: [BRANCH] } as const;

    expect(declaredParamsOf(state)).toEqual([BRANCH]);
    expect(paramsUnknownProblem(state)).toBeUndefined();
  });

  it('has none, and stops a run, while they are still being read', () => {
    expect(declaredParamsOf(PARAMS_LOADING)).toEqual([]);
    expect(paramsUnknownProblem(PARAMS_LOADING)).toContain('still being read');
  });

  it('has none, and stops a run with the reason, after a read that failed', () => {
    const failed = { kind: 'failed', reason: 'The server said no.' } as const;

    expect(declaredParamsOf(failed)).toEqual([]);
    expect(paramsUnknownProblem(failed)).toBe('The server said no.');
  });

  it('tells a workflow that declares none from one not read yet', () => {
    const none = { kind: 'ready', declared: [] } as const;

    expect(declaredParamsOf(none)).toEqual(declaredParamsOf(PARAMS_LOADING));
    expect(paramsUnknownProblem(none)).toBeUndefined();
    expect(paramsUnknownProblem(PARAMS_LOADING)).toBeDefined();
  });
});

describe('keptParams', () => {
  it('keeps the texts of the names given', () => {
    expect(
      keptParams({ branch: 'release', note: 'x' }, new Set(['branch'])),
    ).toEqual({ branch: 'release' });
  });

  it('keeps nothing when no name is given', () => {
    expect(keptParams({ branch: 'release' }, new Set())).toEqual({});
  });

  it('keeps a name as an own key, never the prototype', () => {
    const kept = keptParams(
      withParam({}, '__proto__', 'x'),
      new Set(['__proto__']),
    );

    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
    expect(Object.hasOwn(kept, '__proto__')).toBe(true);
  });
});
