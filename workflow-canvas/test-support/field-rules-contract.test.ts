// SPDX-License-Identifier: Apache-2.0
/** Checks the form's rules against the `stage_fields` that the stub serves. */
import { describe, expect, it } from 'vitest';
import {
  fieldErrors,
  type StageFieldRule,
} from '../src/designer-view/field-rules.ts';
import { STAGE_FIELDS } from '../stub-api/core/fields.ts';

const rules: readonly StageFieldRule[] = STAGE_FIELDS.agent;

describe('the form rules on the stub stage_fields', () => {
  it('accept a stage the stub accepts', () => {
    expect(
      fieldErrors(rules, {
        name: 'draft',
        agent: 'k-developer',
        prompt_file: 'prompts/draft.md',
      }),
    ).toEqual({});
  });

  it('refuse what the contract refuses', () => {
    expect(
      Object.keys(
        fieldErrors(rules, {
          name: 'end',
          agent: 'Not An Id',
          prompt: 'Plan it.',
          prompt_file: '../outside.md',
        }),
      ).sort(),
    ).toEqual(['agent', 'name', 'prompt', 'prompt_file']);
  });
});
