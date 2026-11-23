// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  BLOCK,
  FLOW,
  STAGES_FIRST,
} from '../src/designer-view/sample-texts.ts';
import { checkWorkflowText } from '../stub-api/core/validator.ts';

describe('the sample texts of the YAML pane', () => {
  it.each([
    ['block form', BLOCK],
    ['stages first, CRLF', STAGES_FIRST],
    ['flow form', FLOW],
  ])('give each stage the range the stub reads in %s', (_, sample) => {
    const result = checkWorkflowText(sample.text, 'hello');

    expect(result.diagnostics).toEqual([]);
    expect(
      result.view?.stages.map((stage) => ({
        name: stage.name,
        range: stage.range,
      })),
    ).toEqual(sample.stages);
  });
});
