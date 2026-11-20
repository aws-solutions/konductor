// SPDX-License-Identifier: Apache-2.0
/**
 * Checks that what the Designer assumes about the API is what
 * api/openapi.yaml says: the limits on stages, the form of a name and an
 * agent id, and the calls that saving and checking use.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { KNOWN_AGENTS } from '../src/designer/core/agents.ts';
import { MAX_PROMPT_CHARS, MAX_STAGES } from '../src/designer/core/draft.ts';

interface Spec {
  paths: Record<string, Record<string, { operationId: string }>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

const spec = parse(
  readFileSync(
    fileURLToPath(new URL('../api/openapi.yaml', import.meta.url)),
    'utf8',
  ),
) as Spec;

describe('the Designer and api/openapi.yaml', () => {
  it('allow the same most number of stages', () => {
    const stages = (
      spec.components.schemas.WorkflowView?.properties as Record<
        string,
        { maxItems: number }
      >
    ).stages;

    expect(MAX_STAGES).toBe(stages?.maxItems);
  });

  it('allow the same most number of characters in a prompt', () => {
    const stage = spec.components.schemas.Stage?.properties as Record<
      string,
      { minLength: number; maxLength: number }
    >;

    expect(MAX_PROMPT_CHARS).toBe(stage.prompt?.maxLength);
  });

  it('count a prompt against the limit that the specification gives for stages[].prompt', () => {
    const table = readFileSync(
      fileURLToPath(
        new URL('../../docs/design/workflows-spec.md', import.meta.url),
      ),
      'utf8',
    );
    const row =
      /^\| `stages\[\]\.prompt` +\| string, 1 to (\d+) characters/m.exec(table);

    expect(Number(row?.[1])).toBe(MAX_PROMPT_CHARS);
  });

  it('offer only agent ids that the contract accepts', () => {
    const pattern = new RegExp(String(spec.components.schemas.Name?.pattern));

    for (const { id } of KNOWN_AGENTS) expect(id).toMatch(pattern);
  });

  it('save with PUT /api/workflow and check with POST /api/validate', () => {
    expect(spec.paths['/api/workflow']?.put?.operationId).toBe('saveWorkflow');
    expect(spec.paths['/api/validate']?.post?.operationId).toBe(
      'checkWorkflow',
    );
  });

  it('send a save request with exactly the fields of the contract', () => {
    const request = spec.components.schemas.SaveRequest as {
      required: string[];
      properties: Record<string, unknown>;
    };

    expect(request.required.sort()).toEqual(['base_hash', 'text']);
    expect(Object.keys(request.properties).sort()).toEqual([
      'base_hash',
      'name',
      'text',
    ]);
  });
});
