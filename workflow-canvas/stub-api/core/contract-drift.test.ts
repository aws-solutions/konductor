// SPDX-License-Identifier: Apache-2.0
/** Checks that the codes, limits and patterns of the stub are those of api/openapi.yaml. */
import { describe, expect, it } from 'vitest';
import { STATUS_BY_CODE } from '../http/respond.ts';
import {
  contractDescription,
  errorExamples,
  schemaOf,
} from '../test-support/contract.ts';
import {
  FORMAT,
  HASH_PATTERN,
  MAX_GOAL_CHARS,
  MAX_INTENT_CHARS,
  MAX_PROMPT_CHARS,
  MAX_STAGES,
  MAX_TEXT_BYTES,
  NAME_PATTERN,
  PATH_PATTERN_SOURCE,
  RESERVED_STAGE_NAMES,
  RUN_ID_PATTERN,
  VERSION_PATTERN,
} from './contract.ts';
import { ERROR_CODES, type ErrorCode } from './errors.ts';
import { KEY_TABLES } from './keys.ts';
import { DIAGNOSTIC_CODES } from './model.ts';

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
    for (const request of ['SaveRequest', 'CheckRequest']) {
      const text = property(schemaOf(request), 'text').description as string;
      expect(text, request).toContain(`${MAX_TEXT_BYTES} bytes`);
    }
  });
});
