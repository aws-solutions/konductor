// SPDX-License-Identifier: Apache-2.0
/**
 * Checks the reader of the extra workflow fields against the document that
 * the stub serves, so the two cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { parseWorkflowExtras } from '../src/api/workflow-extras.ts';
import { STAGE_FIELDS } from '../stub-api/core/fields.ts';
import { SAMPLE_FILES, SAMPLE_ROOT } from '../stub-api/core/sample.ts';
import { checkWorkflowText } from '../stub-api/core/validator.ts';

const TEXT = SAMPLE_FILES[SAMPLE_ROOT] ?? '';

function stubDocument(text: string) {
  const check = checkWorkflowText(text, SAMPLE_ROOT);
  return {
    name: SAMPLE_ROOT,
    text,
    hash: 'a'.repeat(64),
    read_only: false,
    view: check.view,
    diagnostics: check.diagnostics,
    stage_fields: STAGE_FIELDS,
  };
}

describe('the extra fields of the document the stub serves', () => {
  const extras = parseWorkflowExtras(stubDocument(TEXT));

  it('reads the keys the stub says a stage may have', () => {
    expect(extras.stageFields).toEqual(STAGE_FIELDS);
  });

  it('reads the default goal of the sample workflow', () => {
    expect(extras.goalDefault).toBe('Add a greeting to the README');
  });

  it('reads a document with no file', () => {
    const empty = { ...stubDocument(''), text: null, hash: null, view: null };
    expect(parseWorkflowExtras(empty).stageFields).toEqual(STAGE_FIELDS);
  });
});
