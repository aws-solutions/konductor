// SPDX-License-Identifier: Apache-2.0
/** Checks that the codes, limits and patterns of the stub are those of api/openapi.yaml. */
import { describe, expect, it } from 'vitest';
import { STATUS_BY_CODE } from '../http/respond.ts';
import {
  contractDescription,
  errorExamples,
  responseExample,
  responseExampleOf,
  schemaOf,
} from '../test-support/contract.ts';
import {
  FORMAT,
  HARNESS,
  HASH_PATTERN,
  MAX_GOAL_CHARS,
  MAX_INTENT_CHARS,
  MAX_PARAM_CHARS,
  MIN_RUN_ARGV,
  MAX_PROMPT_CHARS,
  MAX_STAGES,
  MAX_TEXT_BYTES,
  MAX_YAML_DEPTH,
  NAME_PATTERN,
  OUTPUT_NAME_PATTERN,
  PARAM_NAME_PATTERN,
  PATH_PATTERN_SOURCE,
  REFERENCE_PATTERN_SOURCE,
  RESERVED_STAGE_NAMES,
  RUN_ID_PATTERN,
  SESSION_LIMITS,
  VERSION_PATTERN,
} from './contract.ts';
import { ERROR_CODES, type ErrorCode } from './errors.ts';
import { STAGE_FIELDS } from './fields.ts';
import { KEY_TABLES } from './keys.ts';
import { CHECK_STATES, DIAGNOSTIC_CODES, STAGE_REASONS } from './model.ts';

type Json = Record<string, unknown>;

// The keys of the tables in the description: the key table, with its slice in
// the last column, and the table of reserved keys, with the slice first.
function keyRowsOf(description: string): [key: string, slice: string][] {
  const isSlice = (cell: string | undefined) => /^\d+[ab]?$/.test(cell ?? '');
  return description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    )
    .flatMap((cells): [string, string][] => {
      const first = /^`([^`]+)`$/.exec(cells[0] ?? '')?.[1];
      const last = cells[cells.length - 1];
      if (first && isSlice(last)) return [[first, last as string]];
      if (isSlice(cells[0]) && cells.length === 2) {
        const keys = [...(cells[1] ?? '').matchAll(/`([^`]+)`/g)];
        return keys.map((match): [string, string] => [
          match[1] as string,
          cells[0] as string,
        ]);
      }
      return [];
    });
}

const property = (schema: Json, name: string) =>
  (schema.properties as Record<string, Json>)[name] as Json;

describe('the stub and api/openapi.yaml', () => {
  it('have the same error codes', () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [...(schemaOf('ErrorCode').enum as string[])].sort(),
    );
  });

  it('have the same diagnostic codes', () => {
    expect([...DIAGNOSTIC_CODES].sort()).toEqual(
      [...(schemaOf('DiagnosticCode').enum as string[])].sort(),
    );
  });

  it('give every error code the status that the contract shows with it', () => {
    const shown = errorExamples();
    for (const { status, code } of shown) {
      expect(STATUS_BY_CODE[code as ErrorCode], code).toBe(status);
    }
    // A code with no example is named with its status in the description.
    const description = contractDescription();
    for (const code of ERROR_CODES) {
      const status = STATUS_BY_CODE[code];
      const inExample = shown.some((e) => e.code === code);
      const inText = new RegExp(`${status}\\s+\`${code}\``).test(description);
      expect(inExample || inText, `${status} ${code}`).toBe(true);
    }
  });

  it('have the same patterns', () => {
    expect(schemaOf('Name').pattern).toBe(NAME_PATTERN.source);
    expect(schemaOf('Hash').pattern).toBe(HASH_PATTERN.source);
    expect(schemaOf('RunId').pattern).toBe(RUN_ID_PATTERN.source);
    expect(schemaOf('Version').pattern).toBe(VERSION_PATTERN.source);
    expect(schemaOf('Path').pattern).toBe(PATH_PATTERN_SOURCE);
    expect(schemaOf('ParamName').pattern).toBe(PARAM_NAME_PATTERN.source);
    expect(schemaOf('OutputName').pattern).toBe(OUTPUT_NAME_PATTERN.source);
  });

  it('name the keys of the params and outputs maps by those patterns', () => {
    const maps: [schema: string, key: string, pattern: RegExp][] = [
      ['WorkflowView', 'params', PARAM_NAME_PATTERN],
      ['Stage', 'outputs', OUTPUT_NAME_PATTERN],
      ['RunRequest', 'params', PARAM_NAME_PATTERN],
    ];
    for (const [schema, key, pattern] of maps) {
      const names = property(schemaOf(schema), key).propertyNames as Json;
      expect(names?.pattern, `${schema}.${key}`).toBe(pattern.source);
    }
  });

  it('give each value of those maps the schema the stub reads', () => {
    const outputs = property(schemaOf('Stage'), 'outputs');
    const file = outputs.additionalProperties as Json;
    expect(file.pattern).toBe(PATH_PATTERN_SOURCE);
    const declared = property(schemaOf('WorkflowView'), 'params');
    const param = declared.additionalProperties as Json;
    expect(Object.keys(param.properties as Json).sort()).toEqual([
      'default',
      'description',
      'required',
      'type',
    ]);
    // Every param of a run is a string, whatever the file declares.
    const sent = property(schemaOf('RunRequest'), 'params')
      .additionalProperties as Json;
    expect(sent.type).toBe('string');
  });

  it('give a param the value rules the stub reads', () => {
    const param = property(schemaOf('WorkflowView'), 'params')
      .additionalProperties as Json;
    const type = property(param, 'type');
    expect(type.type).toBe('string');
    // The stub reads the one type, and names the slice for any other.
    expect(type.enum).toEqual(['string']);
    expect(property(param, 'description').type).toBe('string');
    const fallback = property(param, 'default');
    expect(fallback.type).toBe('string');
    // A default is a value the run takes, so it shares the value limit.
    expect(fallback.maxLength).toBe(MAX_PARAM_CHARS);
    expect(property(param, 'required').type).toBe('boolean');
  });

  it('have the same grammar for a reference in a prompt', () => {
    expect(schemaOf('TemplateReference').pattern).toBe(
      REFERENCE_PATTERN_SOURCE,
    );
    expect(contractDescription()).toContain(REFERENCE_PATTERN_SOURCE);
  });

  it('have the same reasons for a blocked stage', () => {
    expect([...STAGE_REASONS].sort()).toEqual(
      [...(schemaOf('StageReason').enum as string[])].sort(),
    );
  });

  it('give a check exactly one of file and run, with the rules the stub reads', () => {
    const check = schemaOf('Check');
    expect(property(check, 'id').pattern).toBe(NAME_PATTERN.source);
    expect(check.required).toEqual(['id']);
    const branches = check.oneOf as Json[];
    expect(branches).toHaveLength(2);
    const [byFile, byRun] = branches as [Json, Json];
    expect(byFile.required).toEqual(['file']);
    expect(property(byFile, 'file').pattern).toBe(PATH_PATTERN_SOURCE);
    expect(byRun.required).toEqual(['run']);
    const run = property(byRun, 'run');
    expect(run.type).toBe('array');
    expect(run.minItems).toBe(MIN_RUN_ARGV);
    expect((run.items as Json).type).toBe('string');
  });

  it('name every done_when entry by a check id', () => {
    const doneWhen = property(schemaOf('Stage'), 'done_when');
    expect(doneWhen.type).toBe('array');
    expect((doneWhen.items as Json).pattern).toBe(NAME_PATTERN.source);
  });

  it('have the same check states', () => {
    expect([...CHECK_STATES].sort()).toEqual(
      [...(schemaOf('CheckState').enum as string[])].sort(),
    );
  });

  it('name the checks of a run by a check id and give each a state', () => {
    const checks = property(schemaOf('Run'), 'checks');
    expect((checks.propertyNames as Json).pattern).toBe(NAME_PATTERN.source);
    expect((checks.additionalProperties as Json).enum).toEqual([
      ...CHECK_STATES,
    ]);
    expect(schemaOf('Run').required).toContain('checks');
  });

  it('report a harness that the contract names', () => {
    expect(schemaOf('Harness').enum).toContain(HARNESS);
  });

  it('have the same format', () => {
    expect(property(schemaOf('WorkflowView'), 'format').const).toBe(FORMAT);
  });

  it('have the same keys, each with the same slice', () => {
    const stub = KEY_TABLES.flatMap((table) => [
      ...table.keys.map((rule) => `${table.prefix}${rule.key} ${rule.slice}`),
      ...(table.otherKeys ? [`${table.prefix}<name> ${table.otherKeys}`] : []),
    ]);
    const contract = keyRowsOf(contractDescription()).map(
      ([key, slice]) => `${key} ${slice}`,
    );
    expect(contract.sort()).toEqual(stub.sort());
  });

  it('have the same reserved stage names', () => {
    const rule = (schemaOf('StageName').allOf as Json[])[1] as {
      not: { enum: string[] };
    };
    expect([...RESERVED_STAGE_NAMES].sort()).toEqual([...rule.not.enum].sort());
  });

  it('have the same limits', () => {
    expect(property(schemaOf('Intent'), 'outcome').maxLength).toBe(
      MAX_INTENT_CHARS,
    );
    expect(property(schemaOf('WorkflowView'), 'stages').maxItems).toBe(
      MAX_STAGES,
    );
    expect(property(schemaOf('Stage'), 'prompt').maxLength).toBe(
      MAX_PROMPT_CHARS,
    );
    const params = property(schemaOf('RunRequest'), 'params');
    expect(property(params, 'goal').maxLength).toBe(MAX_GOAL_CHARS);
    expect((params.additionalProperties as Json).maxLength).toBe(
      MAX_PARAM_CHARS,
    );
    for (const request of ['SaveRequest', 'CheckRequest']) {
      const text = property(schemaOf(request), 'text').description as string;
      expect(text, request).toContain(`${MAX_TEXT_BYTES} bytes`);
    }
    expect(contractDescription()).toContain(
      `nested deeper than ${MAX_YAML_DEPTH} levels`,
    );
  });

  it('report the same fields of a stage', () => {
    const loaded = responseExample('GET', '/api/workflow', 200, 'existing') as {
      stage_fields: unknown;
    };
    expect(STAGE_FIELDS).toEqual(loaded.stage_fields);
  });

  it('report the same limits in the session', () => {
    const session = responseExampleOf('POST', '/api/session', 200) as {
      limits: unknown;
    };
    expect(SESSION_LIMITS).toEqual(session.limits);
    expect(Object.keys(SESSION_LIMITS).sort()).toEqual(
      [...(schemaOf('SessionLimits').required as string[])].sort(),
    );
  });
});
