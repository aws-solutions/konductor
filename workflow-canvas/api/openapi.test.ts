// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
/**
 * Checks openapi.yaml as a contract: its shape, its error codes, how it may
 * grow, and that every example matches its schema and the other examples.
 */
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// The subset of an OpenAPI document that these checks read, after $ref
// pointers have been replaced by the objects they point to.
type Schema = Record<string, unknown>;
interface ExampleObject {
  value?: unknown;
}
interface Example {
  example?: unknown;
  examples?: Record<string, ExampleObject>;
}
interface MediaType extends Example {
  schema?: Schema;
}
interface Response {
  headers?: Record<string, unknown>;
  content?: Record<string, MediaType>;
}
interface Parameter extends Example {
  name: string;
  schema?: Schema;
}
interface Operation {
  operationId?: string;
  summary?: string;
  parameters?: Parameter[];
  requestBody?: Response;
  responses?: Record<string, Response>;
}
interface Spec {
  openapi: string;
  info: { description: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

interface Body {
  label: string;
  status?: string;
  media: MediaType;
}
interface Case {
  label: string;
  status?: string;
  schema: Schema;
  value: unknown;
}

const SPEC_FILE = fileURLToPath(new URL('./openapi.yaml', import.meta.url));
const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete'];
const VERSION_HEADER = 'X-Konductor-Api';

// The first release has these six operations and no others.
const MVP_OPERATIONS = [
  'POST /api/session createSession',
  'GET /api/workflow getWorkflow',
  'PUT /api/workflow saveWorkflow',
  'POST /api/validate checkWorkflow',
  'POST /api/run startRun',
  'GET /api/runs/{id} getRun',
];

// Each error status and the codes that may come with it.
const ERROR_CODES_BY_STATUS: Record<string, string[]> = {
  '400': ['bad_request', 'bad_name', 'bad_hash'],
  '401': ['unauthorized', 'invalid_code'],
  '403': ['forbidden_host', 'forbidden_origin', 'read_only_workflow'],
  '404': ['not_found'],
  '405': ['method_not_allowed'],
  '409': ['conflict', 'already_running', 'harness_unavailable'],
  '413': ['too_large'],
  '422': ['invalid_workflow', 'bad_params'],
  '500': ['io_error'],
};

// The statuses of a run's stages, in run order, that each run status allows.
// P passed, R running, N pending (not started), B blocked.
const STAGE_SEQUENCE_BY_RUN_STATUS: Record<string, RegExp> = {
  running: /^P*R?N*$/,
  passed: /^P+$/,
  halted: /^P*BN*$/,
};
const STAGE_LETTER: Record<string, string> = {
  passed: 'P',
  running: 'R',
  pending: 'N',
  blocked: 'B',
};

const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));

/** Compiles with strict JSON Schema 2020-12 so a loose schema fails loudly. */
function valueMatchesSchema(schema: Schema, value: unknown): boolean {
  return ajv.compile(schema)(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Every object inside a document, each once, so that a shared schema is read
// once and a cycle ends.
function collectObjects(root: unknown, seen = new Set<object>()): Schema[] {
  if (typeof root !== 'object' || root === null || seen.has(root)) return [];
  seen.add(root);
  const children = Object.values(root).flatMap((child) =>
    collectObjects(child, seen),
  );
  return isRecord(root) ? [root, ...children] : children;
}

function listOperations(spec: Spec) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => item[method]).map((method) => ({
      method: method.toUpperCase(),
      path,
      operation: item[method] as Operation,
    })),
  );
}

function exampleValues(source: Example): unknown[] {
  const named = Object.values(source.examples ?? {}).map((e) => e.value);
  return source.example === undefined ? named : [source.example, ...named];
}

function casesOf(
  label: string,
  schema: Schema | undefined,
  source: Example,
  status?: string,
): Case[] {
  return exampleValues(source).map((value, index) => ({
    label: `${label} example ${index + 1}`,
    status,
    schema: schema ?? {},
    value,
  }));
}

function bodiesOf(
  response: Response | undefined,
  label: string,
  status?: string,
) {
  return Object.entries(response?.content ?? {}).map(([type, media]): Body => ({
    label: `${label} ${type}`,
    status,
    media,
  }));
}

function listRequestBodies(spec: Spec): Body[] {
  return listOperations(spec).flatMap(({ method, path, operation }) =>
    bodiesOf(operation.requestBody, `${method} ${path} request`),
  );
}

function listResponses(spec: Spec) {
  return listOperations(spec).flatMap(({ method, path, operation }) =>
    Object.entries(operation.responses ?? {}).map(([status, response]) => ({
      label: `${method} ${path} ${status}`,
      status,
      response,
    })),
  );
}

function listResponseBodies(spec: Spec): Body[] {
  return listResponses(spec).flatMap(({ label, status, response }) =>
    bodiesOf(response, label, status),
  );
}

/** Every example in the spec paired with the schema it must satisfy. */
function listCases(spec: Spec): Case[] {
  const parameters = listOperations(spec).flatMap(
    ({ method, path, operation }) =>
      (operation.parameters ?? []).flatMap((p) =>
        casesOf(`${method} ${path} parameter ${p.name}`, p.schema, p),
      ),
  );
  const bodies = [
    ...listRequestBodies(spec),
    ...listResponseBodies(spec),
  ].flatMap(({ label, status, media }) =>
    casesOf(label, media.schema, media, status),
  );
  const inSchemas = collectObjects(spec.components.schemas)
    .filter((node) => Array.isArray(node['examples']))
    .flatMap((node) =>
      (node['examples'] as unknown[]).map((value, index) => ({
        label: `schema example ${index + 1} of ${JSON.stringify(node['description'] ?? node['pattern'])}`,
        schema: node,
        value,
      })),
    );
  return [...parameters, ...bodies, ...inSchemas];
}

function valuesFor(cases: Case[], schema: Schema): Record<string, unknown>[] {
  return cases
    .filter((c) => c.schema === schema && isRecord(c.value))
    .map((c) => c.value as Record<string, unknown>);
}

function countBySeverity(
  diagnostics: Record<string, unknown>[],
  severity: string,
) {
  return diagnostics.filter((d) => d['severity'] === severity).length;
}

// What a check answer promises about its own fields. Returns the broken promises.
function checkResponseProblems(answer: Record<string, unknown>): string[] {
  const diagnostics = answer['diagnostics'] as Record<string, unknown>[];
  const view = answer['view'] as { stages: unknown[] } | null;
  const summary = answer['summary'] as {
    valid: boolean;
    counts: { stages: number };
  };
  const errors = countBySeverity(diagnostics, 'error');
  const problems: string[] = [];
  if (answer['errors'] !== errors) problems.push('errors');
  if (answer['warnings'] !== countBySeverity(diagnostics, 'warning')) {
    problems.push('warnings');
  }
  if (answer['infos'] !== countBySeverity(diagnostics, 'info')) {
    problems.push('infos');
  }
  if (summary.valid !== (errors === 0)) problems.push('summary.valid');
  if ((view === null) !== errors > 0) problems.push('view');
  if (summary.counts.stages !== (view?.stages.length ?? 0)) {
    problems.push('summary.counts.stages');
  }
  return problems;
}

// A range has no width only where the contract says so: the place a YAML
// parser stopped, and a text that is empty.
function mayHaveNoWidth(d: Record<string, unknown>): boolean {
  return d['code'] === 'YAML_SYNTAX' || d['path'] === '';
}

function diagnosticRangeProblems(diagnostics: Record<string, unknown>[]) {
  return diagnostics
    .filter((d) => {
      const start = [d['line'], d['column']] as number[];
      const end = [d['end_line'], d['end_column']] as number[];
      const before =
        end[0]! < start[0]! || (end[0] === start[0] && end[1]! < start[1]!);
      const empty = end[0] === start[0] && end[1] === start[1];
      return before || (empty && !mayHaveNoWidth(d));
    })
    .map((d) => String(d['path']));
}

// The text between two positions, which count from 1.
function textBetween(text: string, d: Record<string, unknown>): string {
  const lines = text.split('\n');
  const offset = (line: number, column: number) =>
    lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0) +
    column -
    1;
  return text.slice(
    offset(d['line'] as number, d['column'] as number),
    offset(d['end_line'] as number, d['end_column'] as number),
  );
}

// The name quoted in a diagnostic message, such as `owner`.
function quotedIn(message: string): string | undefined {
  return /`([^`]+)`/.exec(message)?.[1];
}

// The stage names and the intent of a workflow text in the form the examples
// use, which has one stage per `- name:` line.
function readExampleText(text: string) {
  return {
    outcome: /^intent: (.*)$/m.exec(text)?.[1],
    stages: [...text.matchAll(/^\s*- name: (\S+)$/gm)].map((m) => m[1]),
  };
}

function viewAgreesWithText(view: unknown, texts: string[]): boolean {
  const { intent, stages } = view as {
    intent: { outcome: string };
    stages: { name: string }[];
  };
  const names = JSON.stringify(stages.map((s) => s.name));
  return texts.some((text) => {
    const read = readExampleText(text);
    return (
      read.outcome === intent.outcome && JSON.stringify(read.stages) === names
    );
  });
}

// What a run promises about its own fields. Returns the broken promises.
function runProblems(run: Record<string, unknown>): string[] {
  const order = run['order'] as string[];
  const stages = run['stages'] as Record<string, { status: string }>;
  const letters = order.map((name) => STAGE_LETTER[stages[name]?.status ?? '']);
  const allowed = STAGE_SEQUENCE_BY_RUN_STATUS[run['status'] as string];
  const problems: string[] = [];
  if (
    JSON.stringify([...order].sort()) !==
    JSON.stringify(Object.keys(stages).sort())
  ) {
    problems.push('order');
  }
  if (new Set(order).size !== order.length) problems.push('order repeats');
  if (!allowed?.test(letters.join(''))) problems.push('stage statuses');
  if (run['status'] === 'running' && letters.every((l) => l === 'P')) {
    problems.push('a running run has no stage left');
  }
  return problems;
}

describe('workflow canvas API contract', () => {
  let spec: Spec;
  let cases: Case[];

  beforeAll(async () => {
    // validate() checks the file against the OpenAPI schema, resolves every
    // $ref and fails on one that cannot be resolved.
    spec = (await SwaggerParser.validate(SPEC_FILE)) as unknown as Spec;
    cases = listCases(spec);
  });

  describe('shape', () => {
    it('is an OpenAPI 3.1 document', () => {
      expect(spec.openapi).toMatch(/^3\.1\./);
    });

    it('has the six operations of the first release and no others', () => {
      const found = listOperations(spec).map(
        ({ method, path, operation }) =>
          `${method} ${path} ${operation.operationId}`,
      );
      expect(found).toEqual(MVP_OPERATIONS);
    });

    it('gives every operation an operationId and a summary', () => {
      for (const { method, path, operation } of listOperations(spec)) {
        expect(operation.operationId, `${method} ${path}`).toBeTruthy();
        expect(operation.summary, `${method} ${path}`).toBeTruthy();
      }
    });

    it('gives every request and response body an example', () => {
      const bodies = [...listRequestBodies(spec), ...listResponseBodies(spec)];
      for (const { label, media } of bodies) {
        expect(exampleValues(media).length, label).toBeGreaterThan(0);
      }
    });

    it('sends the API version header on every response', () => {
      for (const { label, response } of listResponses(spec)) {
        expect(response.headers?.[VERSION_HEADER], label).toBeDefined();
      }
    });
  });

  describe('errors', () => {
    it('answers every error status with the one Error schema', () => {
      const errorSchema = spec.components.schemas['Error'];
      const errorBodies = listResponseBodies(spec).filter(
        ({ status }) => Number(status) >= 400,
      );
      expect(errorBodies.length).toBeGreaterThan(0);
      for (const { label, media } of errorBodies) {
        expect(media.schema, label).toBe(errorSchema);
      }
    });

    it('gives every error example a code that fits its status', () => {
      const errorSchema = spec.components.schemas['Error'];
      const misfits = cases
        .filter((c) => c.schema === errorSchema && Number(c.status) >= 400)
        .filter((c) => {
          const code = (c.value as { code: string }).code;
          return !ERROR_CODES_BY_STATUS[c.status ?? '']?.includes(code);
        })
        .map(({ label }) => label);
      expect(misfits).toEqual([]);
    });

    it('lists exactly the error codes that have a status', () => {
      const declared = spec.components.schemas['ErrorCode']?.['enum'];
      expect([...(declared as string[])].sort()).toEqual(
        Object.values(ERROR_CODES_BY_STATUS).flat().sort(),
      );
    });

    it('describes every diagnostic code, and only those', () => {
      const declared = spec.components.schemas['DiagnosticCode']?.['enum'];
      const described = [
        ...spec.info.description.matchAll(/^\s*\|\s*`([A-Z][A-Z_]+)`\s*\|/gm),
      ].map((match) => match[1]);
      expect([...(declared as string[])].sort()).toEqual(described.sort());
    });
  });

  describe('growth', () => {
    const closed = (schema: Schema | undefined) =>
      collectObjects(schema).filter((node) => isRecord(node['properties']));

    it('refuses unknown fields in every request', () => {
      for (const { label, media } of listRequestBodies(spec)) {
        const open = closed(media.schema).filter(
          (node) => node['additionalProperties'] !== false,
        );
        expect(open, label).toEqual([]);
      }
    });

    it('accepts unknown fields in every response', () => {
      for (const { label, media } of listResponseBodies(spec)) {
        const shut = collectObjects(media.schema).filter(
          (node) => node['additionalProperties'] === false,
        );
        expect(shut, label).toEqual([]);
      }
    });
  });

  describe('examples', () => {
    it('has examples to check', () => {
      expect(cases.length).toBeGreaterThan(0);
    });

    it('has examples that match their schema', () => {
      const mismatches = cases
        .filter(({ schema, value }) => !valueMatchesSchema(schema, value))
        .map(({ label }) => label);
      expect(mismatches).toEqual([]);
    });

    it('has a hash that is the SHA-256 of the text next to it', () => {
      const documents = valuesFor(
        cases,
        spec.components.schemas['WorkflowDocument']!,
      );
      const withText = documents.filter((d) => typeof d['text'] === 'string');
      expect(withText.length).toBeGreaterThan(0);
      for (const document of withText) {
        expect(document['hash']).toBe(sha256(document['text'] as string));
      }
    });

    it('has a saved hash that matches the text that was sent', () => {
      const requests = valuesFor(
        cases,
        spec.components.schemas['SaveRequest']!,
      );
      const update = requests.find((r) => r['base_hash'] !== null)!;
      const [saved] = valuesFor(
        cases,
        spec.components.schemas['SaveResponse']!,
      );
      expect(saved?.['hash']).toBe(sha256(update['text'] as string));
      const [loaded] = valuesFor(
        cases,
        spec.components.schemas['WorkflowDocument']!,
      );
      expect(update['base_hash']).toBe(loaded?.['hash']);
    });

    describe('against the text they are about', () => {
      const textsOf = () =>
        cases.flatMap(({ value }) =>
          collectObjects(value)
            .map((node) => node['text'])
            .filter((text): text is string => typeof text === 'string'),
        );
      const objectsWith = (key: string) =>
        cases.flatMap(({ value }) =>
          collectObjects(value).filter((node) => key in node),
        );

      it('has a view that is what the text says', () => {
        const views = objectsWith('view')
          .map((node) => node['view'])
          .filter(isRecord);
        expect(views.length).toBeGreaterThan(0);
        for (const view of views) {
          expect(
            viewAgreesWithText(view, textsOf()),
            JSON.stringify(view),
          ).toBe(true);
        }
      });

      it('has a diagnostic that points at the name in its message', () => {
        const diagnostics = objectsWith('diagnostics').flatMap(
          (node) => node['diagnostics'] as Record<string, unknown>[],
        );
        expect(diagnostics.length).toBeGreaterThan(0);
        for (const d of diagnostics) {
          const quoted = quotedIn(String(d['message']));
          const found = textsOf().some(
            (text) => textBetween(text, d) === quoted,
          );
          expect(found, String(d['message'])).toBe(true);
        }
      });
    });

    it('has the run that is already active in an already_running answer', () => {
      const busy = cases
        .map((c) => c.value)
        .filter((v) => isRecord(v) && v['code'] === 'already_running');
      expect(busy.length).toBeGreaterThan(0);
      for (const answer of busy) {
        expect(answer).toHaveProperty('run_id');
      }
    });

    it('has check answers that add up', () => {
      const answers = valuesFor(
        cases,
        spec.components.schemas['CheckResponse']!,
      );
      expect(answers.length).toBeGreaterThan(1);
      for (const answer of answers) {
        expect(checkResponseProblems(answer)).toEqual([]);
        const diagnostics = answer['diagnostics'] as Record<string, unknown>[];
        expect(diagnosticRangeProblems(diagnostics)).toEqual([]);
      }
    });

    it('has runs that keep the promises of a run', () => {
      const answers = valuesFor(
        cases,
        spec.components.schemas['RunStatusResponse']!,
      );
      const statuses = answers.map(
        (a) => (a['run'] as { status: string }).status,
      );
      expect(statuses.sort()).toEqual(['halted', 'passed', 'running']);
      for (const answer of answers) {
        expect(runProblems(answer['run'] as Record<string, unknown>)).toEqual(
          [],
        );
      }
    });
  });

  describe('the checks themselves', () => {
    it('rejects an example that does not match its schema', () => {
      const run = spec.components.schemas['Run']!;
      expect(valueMatchesSchema(run, { run_id: 'not-a-run-id' })).toBe(false);
    });

    it('rejects a time that is not UTC to the whole second', () => {
      const timestamp = spec.components.schemas['Timestamp']!;
      expect(valueMatchesSchema(timestamp, '2026-10-24T04:12:05Z')).toBe(true);
      expect(valueMatchesSchema(timestamp, '2026-10-24T06:12:05+02:00')).toBe(
        false,
      );
      expect(valueMatchesSchema(timestamp, '2026-10-24T04:12:05.250Z')).toBe(
        false,
      );
    });

    it('finds a diagnostic that points at the wrong place', () => {
      const text = 'name: hello\nowner: me\n';
      const d = { line: 2, column: 1, end_line: 2, end_column: 6 };
      expect(textBetween(text, d)).toBe('owner');
      expect(textBetween(text, { ...d, column: 2 })).not.toBe('owner');
    });

    it('rejects a passed run that has an exit code of 1', () => {
      const [answer] = valuesFor(
        cases,
        spec.components.schemas['RunStatusResponse']!,
      );
      const passed = { ...(answer!['run'] as object), status: 'passed' };
      const run = spec.components.schemas['Run']!;
      expect(valueMatchesSchema(run, { ...passed, exit_code: 1 })).toBe(false);
    });

    it('finds a check answer whose counts are wrong', () => {
      const [answer] = valuesFor(
        cases,
        spec.components.schemas['CheckResponse']!,
      );
      expect(checkResponseProblems({ ...answer!, errors: 3 })).toContain(
        'errors',
      );
    });

    it('finds a run whose order is not its stages', () => {
      const [answer] = valuesFor(
        cases,
        spec.components.schemas['RunStatusResponse']!,
      );
      const run = { ...(answer!['run'] as object), order: ['review', 'other'] };
      expect(runProblems(run as Record<string, unknown>)).toContain('order');
    });
  });
});
