// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import type { StageFieldRule } from '../designer-view/field-rules';
import {
  parseWorkflowExtras,
  stageExtrasOf,
  stageFieldsOf,
  type StageFieldInfo,
} from './workflow-extras';

const FIELDS = {
  agent: [
    { key: 'name', type: 'name', required: true, max_length: 64 },
    { key: 'agent', type: 'name', required: true, pattern: '[a-z-]+' },
    {
      key: 'prompt',
      type: 'text',
      required: false,
      min_length: 1,
      excludes: ['prompt_file'],
    },
  ],
};

const body = (over: Record<string, unknown> = {}) => ({
  name: 'hello',
  text: 'format: konductor/1\n',
  hash: 'h1',
  read_only: false,
  view: {
    format: 'konductor/1',
    version: '0.1.0',
    name: 'hello',
    intent: { outcome: 'Add a greeting' },
    params: { goal: { description: 'What to do.', default: 'Say hello' } },
    stages: [
      {
        name: 'draft',
        kind: 'agent',
        agent: 'k-developer',
        range: { line: 10, end_line: 12 },
      },
      {
        name: 'review',
        kind: 'agent',
        agent: 'k-quality-assurance',
        range: { line: 13, end_line: 13 },
      },
    ],
  },
  diagnostics: [],
  stage_fields: FIELDS,
  ...over,
});

// The rules of the form take a field as the server sends it.
const asRules: readonly StageFieldRule[] =
  FIELDS.agent satisfies readonly StageFieldInfo[];

describe('parseWorkflowExtras', () => {
  it('reads the kind and the lines of each stage, in run order', () => {
    expect(parseWorkflowExtras(body()).stages).toEqual([
      { name: 'draft', kind: 'agent', range: { line: 10, endLine: 12 } },
      { name: 'review', kind: 'agent', range: { line: 13, endLine: 13 } },
    ]);
  });

  it('reads the editable keys of a stage by kind', () => {
    expect(parseWorkflowExtras(body()).stageFields.agent).toEqual(FIELDS.agent);
  });

  it('reads the default goal the workflow declares', () => {
    expect(parseWorkflowExtras(body()).goalDefault).toBe('Say hello');
  });

  it('leaves out the default goal when the workflow declares none', () => {
    const view = { ...body().view, params: { goal: { description: 'x' } } };
    expect(parseWorkflowExtras(body({ view }))).not.toHaveProperty(
      'goalDefault',
    );
  });

  it('leaves out the default goal when the workflow has no params', () => {
    const view = { ...body().view };
    delete (view as { params?: unknown }).params;
    expect(parseWorkflowExtras(body({ view }))).not.toHaveProperty(
      'goalDefault',
    );
  });

  it('keeps an empty default goal, which the contract allows', () => {
    const view = { ...body().view, params: { goal: { default: '' } } };
    expect(parseWorkflowExtras(body({ view })).goalDefault).toBe('');
  });

  it('keeps a kind this page does not know', () => {
    const view = {
      ...body().view,
      stages: [
        { name: 'ask', kind: 'human_input', range: { line: 1, end_line: 2 } },
      ],
    };
    expect(parseWorkflowExtras(body({ view })).stages[0]?.kind).toBe(
      'human_input',
    );
  });

  it('keeps the keys of a kind this page does not know', () => {
    const fields = {
      ...FIELDS,
      uses: [{ key: 'uses', type: 'path', required: true }],
    };
    expect(
      parseWorkflowExtras(body({ stage_fields: fields })).stageFields.uses,
    ).toHaveLength(1);
  });

  it('reads the keys of a stage with no view', () => {
    const extras = parseWorkflowExtras(body({ view: null }));
    expect(extras.stages).toEqual([]);
    expect(extras.stageFields.agent).toHaveLength(3);
  });

  it('ignores a field the page does not read', () => {
    const fields = {
      agent: [{ key: 'name', type: 'name', required: true, nullable: true }],
    };
    expect(
      parseWorkflowExtras(body({ stage_fields: fields })).stageFields.agent,
    ).toEqual([{ key: 'name', type: 'name', required: true }]);
  });

  it.each([
    ['a body that is not an object', 'not a document'],
    ['no stage_fields', { ...body(), stage_fields: undefined }],
  ])('refuses %s', (_, given) => {
    expect(() => parseWorkflowExtras(given)).toThrow(ApiError);
  });

  it.each([
    ['stage_fields without the agent kind', { other: FIELDS.agent }],
    ['stage_fields that is a list', [FIELDS.agent]],
    ['a kind with no key at all', { agent: [] }],
    ['a key with no name', { agent: [{ type: 'name', required: true }] }],
    [
      'a key that does not say whether it is required',
      { agent: [{ key: 'name', type: 'name' }] },
    ],
    [
      'a length that is not a whole number',
      { agent: [{ ...FIELDS.agent[0], max_length: 1.5 }] },
    ],
    ['a max_length of 0', { agent: [{ ...FIELDS.agent[0], max_length: 0 }] }],
    [
      'reserved values that are not strings',
      { agent: [{ ...FIELDS.agent[0], reserved: [1] }] },
    ],
  ])('refuses %s', (_, fields) => {
    expect(() => parseWorkflowExtras(body({ stage_fields: fields }))).toThrow(
      ApiError,
    );
  });

  it.each([
    [
      'a stage with no kind',
      { name: 'draft', range: { line: 1, end_line: 2 } },
    ],
    ['a stage with no range', { name: 'draft', kind: 'agent' }],
    [
      'a range that starts at 0',
      { name: 'd', kind: 'agent', range: { line: 0, end_line: 2 } },
    ],
    [
      'a range that ends before it starts',
      { name: 'd', kind: 'agent', range: { line: 9, end_line: 8 } },
    ],
    [
      'a range line that is not whole',
      { name: 'd', kind: 'agent', range: { line: 1.5, end_line: 2 } },
    ],
  ])('refuses %s', (_, stage) => {
    const view = { ...body().view, stages: [stage] };
    expect(() => parseWorkflowExtras(body({ view }))).toThrow(ApiError);
  });

  it('refuses two stages with one name', () => {
    const stage = {
      name: 'draft',
      kind: 'agent',
      range: { line: 1, end_line: 2 },
    };
    const view = { ...body().view, stages: [stage, { ...stage }] };
    expect(() => parseWorkflowExtras(body({ view }))).toThrow(ApiError);
  });

  it('refuses params written as a list', () => {
    const view = { ...body().view, params: [{ goal: {} }] };
    expect(() => parseWorkflowExtras(body({ view }))).toThrow(ApiError);
  });

  it('refuses a default goal that is not a string', () => {
    const view = { ...body().view, params: { goal: { default: 7 } } };
    expect(() => parseWorkflowExtras(body({ view }))).toThrow(ApiError);
  });
});

describe('stageExtrasOf', () => {
  it('finds a stage by name', () => {
    expect(stageExtrasOf(parseWorkflowExtras(body()), 'review')?.range).toEqual(
      { line: 13, endLine: 13 },
    );
  });

  it('finds no stage that the view does not have', () => {
    expect(
      stageExtrasOf(parseWorkflowExtras(body()), 'wrap-up'),
    ).toBeUndefined();
  });
});

describe('stageFieldsOf', () => {
  it('gives the keys of a kind the server described', () => {
    expect(stageFieldsOf(parseWorkflowExtras(body()), 'agent')).toEqual(
      asRules,
    );
  });

  it('gives no key for a kind the server did not describe', () => {
    expect(stageFieldsOf(parseWorkflowExtras(body()), 'uses')).toEqual([]);
  });
});
