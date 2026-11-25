// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import type { StageFieldRule } from '../designer-view/field-rules';
import { parseWorkflowExtras, type StageField } from './workflow-extras';

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
    ],
  },
  diagnostics: [],
  stage_fields: FIELDS,
  ...over,
});

// The rules of the form take a field as the server sends it.
const asRules: readonly StageFieldRule[] =
  FIELDS.agent satisfies readonly StageField[];

describe('parseWorkflowExtras', () => {
  it('reads the editable keys of a stage by kind', () => {
    expect(parseWorkflowExtras(body()).stageFields.agent).toEqual(asRules);
  });

  it('reads the default goal the workflow declares', () => {
    expect(parseWorkflowExtras(body()).goalDefault).toBe('Say hello');
  });

  it('leaves the stages of the view to the check the Design view makes', () => {
    expect(parseWorkflowExtras(body())).not.toHaveProperty('stages');
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

  it('keeps the keys of a kind this page does not know', () => {
    const fields = {
      ...FIELDS,
      uses: [{ key: 'uses', type: 'path', required: true }],
    };
    expect(
      parseWorkflowExtras(body({ stage_fields: fields })).stageFields.uses,
    ).toHaveLength(1);
  });

  it('reads the keys of a stage for a document with no file', () => {
    const extras = parseWorkflowExtras(body({ view: null }));
    expect(extras.stageFields.agent).toHaveLength(3);
    expect(extras).not.toHaveProperty('goalDefault');
  });

  it('ignores a stage of the view that it does not read', () => {
    const view = { ...body().view, stages: [{ name: 'draft' }] };
    expect(parseWorkflowExtras(body({ view })).goalDefault).toBe('Say hello');
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

  it('refuses a view that is not a mapping', () => {
    expect(() => parseWorkflowExtras(body({ view: 'hello' }))).toThrow(
      ApiError,
    );
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

/** A view whose params are the mapping given. */
const withParams = (params: Record<string, unknown>) =>
  body({ view: { ...body().view, params } });

describe('parseWorkflowExtras, the declared params', () => {
  it('reads every key of a param', () => {
    const extras = parseWorkflowExtras(
      withParams({
        diff_input: {
          type: 'string',
          description: 'The diff to read.',
          default: 'the.diff',
          required: true,
        },
      }),
    );

    expect(extras.params).toEqual([
      {
        name: 'diff_input',
        type: 'string',
        description: 'The diff to read.',
        default: 'the.diff',
        required: true,
      },
    ]);
  });

  it('keeps the order of the file', () => {
    const extras = parseWorkflowExtras(
      withParams({ branch: {}, goal: {}, diff_input: {} }),
    );

    expect(extras.params?.map((param) => param.name)).toEqual([
      'branch',
      'diff_input',
    ]);
  });

  it('takes a param that is not required unless the file says so', () => {
    const extras = parseWorkflowExtras(withParams({ branch: {} }));

    expect(extras.params?.[0]?.required).toBe(false);
  });

  it('leaves the params out when the goal is the only one', () => {
    expect(
      parseWorkflowExtras(withParams({ goal: { default: 'Say hello' } })),
    ).not.toHaveProperty('params');
  });

  it('leaves the params out for a document with no file', () => {
    expect(parseWorkflowExtras(body({ view: null }))).not.toHaveProperty(
      'params',
    );
  });

  it.each([
    ['a param that is not a mapping', { branch: 'main' }],
    ['a default that is not a string', { branch: { default: 7 } }],
    ['a required that is not a boolean', { branch: { required: 'yes' } }],
    ['a type that is not a string', { branch: { type: 1 } }],
    ['a description that is not a string', { branch: { description: 1 } }],
  ])('refuses %s', (_, params) => {
    expect(() => parseWorkflowExtras(withParams(params))).toThrow(ApiError);
  });
});
