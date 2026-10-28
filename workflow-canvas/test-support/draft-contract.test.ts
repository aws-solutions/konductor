// SPDX-License-Identifier: Apache-2.0
/** Checks that the limits of the draft are those of api/openapi.yaml. */
import { describe, expect, it } from 'vitest';
import { MAX_STAGES } from '../src/designer/core/draft.ts';
import { schemaOf } from '../stub-api/test-support/contract.ts';

type Json = Record<string, unknown>;

describe('the draft and api/openapi.yaml', () => {
  it('allow the same number of stages', () => {
    const properties = schemaOf('WorkflowView').properties as Record<
      string,
      Json
    >;

    expect(properties.stages?.maxItems).toBe(MAX_STAGES);
  });
});
