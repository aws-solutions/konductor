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
import { isMap, isSeq, LineCounter, parse, parseDocument } from 'yaml';

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
  description?: string;
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

// A client picks what to call by these ids, so renaming one breaks it.
const STABLE_OPERATION_IDS = [
  'createSession',
  'getWorkflow',
  'saveWorkflow',
  'checkWorkflow',
  'startRun',
  'getRun',
  'listAgents',
  'getRunEvents',
  'listRuns',
  'listLibrary',
  'getLibraryWorkflow',
  'copyLibraryWorkflow',
];

// This version has these operations and no others.
const OPERATIONS = [
  'POST /api/session createSession',
  'GET /api/workflow getWorkflow',
  'PUT /api/workflow saveWorkflow',
  'GET /api/library listLibrary',
  'GET /api/library/{name} getLibraryWorkflow',
  'POST /api/library/{name}/copy copyLibraryWorkflow',
  'GET /api/agents listAgents',
  'POST /api/validate checkWorkflow',
  'POST /api/run startRun',
  'GET /api/runs listRuns',
  'GET /api/runs/{id} getRun',
  'GET /api/runs/{id}/events getRunEvents',
];

// Each error status and the codes that may come with it.
const ERROR_CODES_BY_STATUS: Record<string, string[]> = {
  '400': ['bad_request', 'bad_name', 'bad_hash'],
  '401': ['unauthorized', 'invalid_code'],
  '403': ['forbidden_host', 'forbidden_origin', 'read_only_workflow'],
  '404': ['not_found'],
  '405': ['method_not_allowed'],
  '409': [
    'conflict',
    'already_running',
    'harness_unavailable',
    'trust_required',
  ],
  '413': ['too_large'],
  '422': ['invalid_workflow', 'bad_params', 'not_available'],
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

// The line numbers, from 1, of the lines of a text that start with a prefix.
function linesStartingWith(text: string, prefix: string): number[] {
  return text
    .split('\n')
    .flatMap((line, index) => (line.startsWith(prefix) ? [index + 1] : []));
}

// The codes whose position is the name that their message quotes. The others
// point at a whole mapping or at a value, which the message does not repeat.
const POINTS_AT_NAME = new Set([
  'UNKNOWN_KEY',
  'DUPLICATE_KEY',
  'DUPLICATE_STAGE',
  'NOT_SUPPORTED_BY_THIS_BUILD',
]);

// The name quoted in a diagnostic message, such as `owner`.
function quotedIn(message: string): string | undefined {
  return /`([^`]+)`/.exec(message)?.[1];
}

// The stage names and the intent of a workflow text in the form the examples
// use, which has one stage per `- name:` line.
function readExampleText(text: string) {
  return {
    outcome: /^intent:\n {2}outcome: (.*)$/m.exec(text)?.[1],
    stages: [...text.matchAll(/^\s*- name: (\S+)$/gm)].map((m) => m[1]),
  };
}

function viewAgreesWithText(view: unknown, text: string): boolean {
  const { intent, stages } = view as {
    intent: { outcome: string };
    stages: { name: string }[];
  };
  const read = readExampleText(text);
  return (
    read.outcome === intent.outcome &&
    JSON.stringify(read.stages) ===
      JSON.stringify(stages.map((stage) => stage.name))
  );
}

// The kind and the lines of each stage of a text, worked out with the yaml
// package and not the stub, so the examples are checked against a second reader.
function stagePlacesOf(text: string) {
  const counter = new LineCounter();
  const doc = parseDocument(text, { version: '1.2', lineCounter: counter });
  const stages = isMap(doc.contents) ? doc.contents.get('stages') : undefined;
  if (!isSeq(stages)) return [];
  return stages.items.map((item) => {
    const { range } = item as { range: readonly [number, number, number] };
    const [start, end] = range;
    const last = text.slice(start, end).trimEnd().length + start - 1;
    return {
      kind: isMap(item) && item.has('agent') ? 'agent' : undefined,
      range: {
        line: counter.linePos(start).line,
        end_line: counter.linePos(last).line,
      },
    };
  });
}

// An example answer and the workflow text it is an answer about.
interface TextAndAnswer {
  label: string;
  text: string;
  answer: Record<string, unknown>;
}

// Every diagnostic of the answers, with the text it is about.
function diagnosticsOf(pairs: TextAndAnswer[]) {
  return pairs.flatMap(({ label, text, answer }) =>
    (answer['diagnostics'] as Record<string, unknown>[]).map((d) => ({
      label: `${label}: ${String(d['message'])}`,
      text,
      d,
    })),
  );
}

function jsonBodyOf(spec: Spec, route: string, status?: string): MediaType {
  const [method, path] = route.split(' ') as [string, string];
  const operation = spec.paths[path]?.[method.toLowerCase()];
  const holder =
    status === undefined
      ? operation?.requestBody
      : operation?.responses?.[status];
  const media = holder?.content?.['application/json'];
  if (!media) throw new Error(`No JSON body for ${route} ${status ?? ''}`);
  return media;
}

function namedExample(media: MediaType, name: string) {
  const value = media.examples?.[name]?.value;
  if (!isRecord(value)) throw new Error(`No example named ${name}`);
  return value;
}

/**
 * Each answer example next to the text it answers: a check with the request
 * of its name, a load with its own text, and a save with the request it follows.
 */
function listTextsAndAnswers(spec: Spec): TextAndAnswer[] {
  const checkRequest = jsonBodyOf(spec, 'POST /api/validate');
  const checkAnswer = jsonBodyOf(spec, 'POST /api/validate', '200');
  const saveRequest = jsonBodyOf(spec, 'PUT /api/workflow');
  const loaded = jsonBodyOf(spec, 'GET /api/workflow', '200');
  const textOf = (media: MediaType, name: string) =>
    namedExample(media, name)['text'] as string;

  const checks = Object.keys(checkAnswer.examples ?? {}).map((name) => ({
    label: `check ${name}`,
    text: textOf(checkRequest, name),
    answer: namedExample(checkAnswer, name),
  }));
  // A root that has no file yet has no text, which reads as an empty one.
  const loads = Object.keys(loaded.examples ?? {}).map((name) => {
    const answer = namedExample(loaded, name);
    return {
      label: `load ${name}`,
      text: (answer['text'] as string | null) ?? '',
      answer,
    };
  });
  const saved = {
    label: 'save update',
    text: textOf(saveRequest, 'update'),
    answer: jsonBodyOf(spec, 'PUT /api/workflow', '200').example as Record<
      string,
      unknown
    >,
  };
  const refused = {
    label: 'save unknownKey',
    text: textOf(saveRequest, 'unknownKey'),
    answer: namedExample(
      jsonBodyOf(spec, 'PUT /api/workflow', '422'),
      'invalid',
    ),
  };
  const library = jsonBodyOf(spec, 'GET /api/library/{name}', '200')
    .example as Record<string, unknown>;
  const copied = jsonBodyOf(spec, 'POST /api/library/{name}/copy', '200')
    .example as Record<string, unknown>;
  return [
    ...checks,
    ...loads,
    saved,
    refused,
    {
      label: 'library entry',
      text: library['text'] as string,
      answer: library,
    },
    { label: 'library copy', text: copied['text'] as string, answer: copied },
  ];
}

// What a run promises about its own fields. Returns the broken promises.
function runProblems(run: Record<string, unknown>): string[] {
  const order = run['order'] as string[];
  const stages = run['stages'] as Record<
    string,
    { status: string; reason?: string }
  >;
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
  // Only a blocked stage has a reason, and it has one.
  const reasoned = Object.values(stages).every(
    (stage) => (stage.status === 'blocked') === (stage.reason !== undefined),
  );
  if (!reasoned) problems.push('reason');
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

    it('has the operations of this version and no others', () => {
      const found = listOperations(spec).map(
        ({ method, path, operation }) =>
          `${method} ${path} ${operation.operationId}`,
      );
      expect(found).toEqual(OPERATIONS);
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

    it('documents a response for every status that has an error code', () => {
      const documented = new Set(listResponses(spec).map((r) => r.status));
      const missing = Object.keys(ERROR_CODES_BY_STATUS).filter(
        (status) => !documented.has(status),
      );
      expect(missing).toEqual([]);
    });

    it('answers a method the path does not list with 405 and an Allow header', () => {
      const operations = listOperations(spec);
      for (const { method, path, operation } of operations) {
        const response = operation.responses?.['405'];
        const label = `${method} ${path}`;
        const allow = response?.headers?.['Allow'];
        expect(allow, label).toBeDefined();
        const listed = String((allow as { example?: unknown }).example)
          .split(',')
          .map((name) => name.trim())
          .sort();
        const accepted = operations
          .filter((other) => other.path === path)
          .map((other) => other.method)
          .sort();
        expect(listed, `${label} Allow`).toEqual(accepted);
        const examples = bodiesOf(response, label, '405').flatMap(({ media }) =>
          exampleValues(media),
        );
        expect(examples, label).toContainEqual(
          expect.objectContaining({ code: 'method_not_allowed' }),
        );
      }
    });

    it('says which YAML the workflow text is', () => {
      expect(spec.info.description).toMatch(
        /YAML 1\.2 read with the core schema/,
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

    // A request object that lists its properties must refuse any other
    // field. The exception is a mapping whose keys are named by a pattern
    // and whose values have a schema of their own, as a run's `params` is:
    // a key the pattern refuses never reaches the server, and a key it
    // allows but the workflow does not declare is `bad_params`.
    const named = (node: Schema) =>
      node['propertyNames'] !== undefined &&
      isRecord(node['additionalProperties']);

    it('refuses unknown fields in every request', () => {
      for (const { label, media } of listRequestBodies(spec)) {
        const open = closed(media.schema).filter(
          (node) => node['additionalProperties'] !== false && !named(node),
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
      let pairs: TextAndAnswer[];
      beforeAll(() => {
        pairs = listTextsAndAnswers(spec);
      });

      it('has a text for every answer that has a view or diagnostics', () => {
        const paired = new Set(pairs.map(({ answer }) => answer));
        const unpaired = cases
          .flatMap(({ value }) => collectObjects(value))
          .filter((node) => 'view' in node || 'diagnostics' in node)
          .filter((node) => !paired.has(node));
        expect(unpaired).toEqual([]);
      });

      it('has a view that is what its own text says', () => {
        const withView = pairs.filter(({ answer }) => isRecord(answer['view']));
        expect(withView.length).toBeGreaterThan(0);
        for (const { label, text, answer } of withView) {
          expect(viewAgreesWithText(answer['view'], text), label).toBe(true);
        }
      });

      it('has a view that is its text read as YAML, with the name filled in', () => {
        const withView = pairs.filter(({ answer }) => isRecord(answer['view']));
        for (const { label, text, answer } of withView) {
          const read = parse(text, { version: '1.2' }) as {
            stages: Record<string, unknown>[];
          };
          const places = stagePlacesOf(text);
          const stages = read.stages.map((stage, index) => ({
            ...stage,
            ...places[index],
          }));
          const documentName = String(answer['name'] ?? 'hello');
          const inferredName = documentName.startsWith('library/')
            ? documentName.slice('library/'.length)
            : documentName;
          expect(answer['view'], label).toEqual({
            name: inferredName,
            ...read,
            stages,
          });
        }
      });

      it('has a diagnostic that points at the name in its message', () => {
        const found = diagnosticsOf(pairs).filter(({ d }) =>
          POINTS_AT_NAME.has(String(d['code'])),
        );
        expect(found.length).toBeGreaterThan(0);
        for (const { label, text, d } of found) {
          expect(textBetween(text, d), label).toBe(
            quotedIn(String(d['message'])),
          );
        }
      });

      it('has a diagnostic of another code that points at some text', () => {
        const found = diagnosticsOf(pairs).filter(
          ({ d }) => !POINTS_AT_NAME.has(String(d['code'])),
        );
        expect(found.length).toBeGreaterThan(0);
        for (const { label, text, d } of found) {
          expect(textBetween(text, d).trim(), label).not.toBe('');
        }
      });

      it('reports a repeated key at the later one', () => {
        const { text, answer } = pairs.find(
          ({ label }) => label === 'check duplicateKey',
        )!;
        const [diagnostic] = answer['diagnostics'] as Record<string, unknown>[];
        const secondIntent = linesStartingWith(text, 'intent:')[1];
        expect(diagnostic?.['code']).toBe('DUPLICATE_KEY');
        expect(diagnostic).toMatchObject({
          line: secondIntent,
          column: 1,
          end_line: secondIntent,
          end_column: 1 + 'intent'.length,
        });
      });

      it('reports a repeated unknown key at the first and at each later one', () => {
        const { text, answer } = pairs.find(
          ({ label }) => label === 'check unknownKeyTwice',
        )!;
        const [first, later] = linesStartingWith(text, 'owner:');
        const found = (answer['diagnostics'] as Record<string, unknown>[]).map(
          (d) => [d['code'], d['line'], d['path']],
        );
        expect(found).toEqual([
          ['UNKNOWN_KEY', first, 'owner'],
          ['DUPLICATE_KEY', later, 'owner'],
        ]);
      });

      it('keeps keys whose text differs apart, even when they read alike', () => {
        const { answer } = pairs.find(
          ({ label }) => label === 'check distinctKeys',
        )!;
        const found = (answer['diagnostics'] as Record<string, unknown>[]).map(
          (d) => [d['code'], d['path']],
        );
        expect(found).toEqual([
          ['UNKNOWN_KEY', 'True'],
          ['UNKNOWN_KEY', 'true'],
          ['UNKNOWN_KEY', '1.0'],
          ['UNKNOWN_KEY', '1'],
        ]);
      });

      it('says how keys are compared and which are not supported', () => {
        const description = spec.info.description;
        expect(description).toMatch(
          /before they are read as a number, boolean or null/,
        );
        expect(description).toMatch(/`1` and `'1'` are one key/);
        expect(description).toMatch(/a key that is not a scalar/);
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

    it('has a conflict with and without the hash of the file now', () => {
      const body = jsonBodyOf(spec, 'PUT /api/workflow', '409');
      const changed = namedExample(body, 'changed');
      const exists = namedExample(body, 'exists');
      const deleted = namedExample(body, 'deleted');
      expect(changed).toHaveProperty('current_hash');
      expect(exists).toHaveProperty('current_hash');
      expect(deleted).not.toHaveProperty('current_hash');
      expect([changed['code'], exists['code'], deleted['code']]).toEqual([
        'conflict',
        'conflict',
        'conflict',
      ]);
      expect(spec.info.description).toMatch(
        /for a file that does not exist[^.]*is also 409 `conflict`, with no `current_hash`/s,
      );
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

  describe('library document response shapes', () => {
    const response = (route: string) => {
      const media = jsonBodyOf(spec, route, '200');
      return {
        schema: media.schema!,
        example: media.example as Record<string, unknown>,
      };
    };

    it.each([
      ['name', 'hello'],
      ['read_only', false],
      ['text', null],
      ['hash', null],
      ['view', null],
    ])('rejects a ready detail with %s changed', (key, value) => {
      const { schema, example } = response('GET /api/library/{name}');
      expect(valueMatchesSchema(schema, { ...example, [key]: value })).toBe(
        false,
      );
    });

    it.each([
      ['name', 'library/k-adversarial-pull-request-review'],
      ['read_only', true],
      ['text', null],
      ['hash', null],
      ['view', null],
    ])('rejects a copy with %s changed', (key, value) => {
      const { schema, example } = response('POST /api/library/{name}/copy');
      expect(valueMatchesSchema(schema, { ...example, [key]: value })).toBe(
        false,
      );
    });
    it('documents name conflicts and active runs on copy', () => {
      const body = jsonBodyOf(spec, 'POST /api/library/{name}/copy', '409');
      expect(namedExample(body, 'conflict')).toMatchObject({
        code: 'conflict',
      });
      expect(namedExample(body, 'busy')).toMatchObject({
        code: 'already_running',
        run_id: expect.any(String),
      });
      expect(spec.info.description.replace(/\s+/g, ' ')).toMatch(
        /Version 1\.13\.0 only adds `already_running` to the copy operation/,
      );
    });

    it('keeps ordinary workflow identities out of library lookup space', () => {
      const detail = response('GET /api/library/{name}').example;
      const view = detail['view'] as Record<string, unknown>;
      expect(
        valueMatchesSchema(spec.components.schemas['WorkflowView']!, {
          ...view,
          name: detail['name'],
        }),
      ).toBe(false);
      const ordinary = namedExample(
        jsonBodyOf(spec, 'GET /api/workflow', '200'),
        'existing',
      );
      expect(
        valueMatchesSchema(spec.components.schemas['WorkflowDocument']!, {
          ...ordinary,
          name: detail['name'],
        }),
      ).toBe(false);
    });

    it('matches detail and copy view identities to their requests', () => {
      const detail = response('GET /api/library/{name}').example;
      const detailView = detail['view'] as Record<string, unknown>;
      expect(detailView['name']).toBe(
        String(detail['name']).slice('library/'.length),
      );
      const copy = response('POST /api/library/{name}/copy').example;
      const copyView = copy['view'] as Record<string, unknown>;
      const request = jsonBodyOf(spec, 'POST /api/library/{name}/copy')
        .example as Record<string, unknown>;
      expect(copy['name']).toBe(request['as']);
      expect(copyView['name']).toBe(request['as']);
    });

    it('requires unique lookup ids in a library list', () => {
      const media = jsonBodyOf(spec, 'GET /api/library', '200');
      const list = media.example as { entries: Record<string, unknown>[] };
      const unique = (entries: Record<string, unknown>[]) =>
        new Set(entries.map((entry) => entry['name'])).size === entries.length;
      expect(unique(list.entries)).toBe(true);
      expect(unique([...list.entries, { ...list.entries[0]! }])).toBe(false);
      expect(JSON.stringify(spec.components.schemas['LibraryList'])).toContain(
        'Lookup ids are unique',
      );
    });
    it('bounds the list and each display string', () => {
      const libraryList = spec.components.schemas['LibraryList']!;
      const entries = Array.from({ length: 100 }, (_, index) => ({
        name: `library/workflow-${index}`,
        title: 't'.repeat(120),
        summary: 's'.repeat(240),
        status: 'planned',
        waits: 'w'.repeat(240),
      }));
      expect(valueMatchesSchema(libraryList, { entries })).toBe(true);
      expect(
        valueMatchesSchema(libraryList, {
          entries: [...entries, { ...entries[0]!, name: 'library/overflow' }],
        }),
      ).toBe(false);
      for (const key of ['title', 'summary', 'waits'] as const) {
        const tooLong = key === 'title' ? 'x'.repeat(121) : 'x'.repeat(241);
        expect(
          valueMatchesSchema(libraryList, {
            entries: [{ ...entries[0]!, [key]: tooLong }],
          }),
        ).toBe(false);
      }
    });
  });

  describe('what two servers must do alike', () => {
    const words = (text: string) => text.replace(/\s+/g, ' ');

    it('makes a save check the hash and write as one step, and create exclusively', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(
        /Checking `base_hash` and writing are one step with respect to any other save/,
      );
      expect(description).toMatch(
        /of two saves with the same `base_hash`, one succeeds and the other is 409 `conflict`/,
      );
      expect(description).toMatch(
        /With a `base_hash` of `null` the server creates the file exclusively/,
      );
      const save = spec.paths['/api/workflow']?.['put']?.description ?? '';
      expect(words(save)).toMatch(
        /check of `base_hash` and the write are one step/,
      );
    });

    it('starts the 60 second launch window when the address is printed', () => {
      const fromPrint =
        /60 seconds (of|from)\s+the moment the server prints the launch address/;
      const session = spec.paths['/api/session']?.['post']?.description ?? '';
      expect(words(spec.info.description)).toMatch(fromPrint);
      expect(words(session)).toMatch(fromPrint);
    });
  });

  describe('the page and the token', () => {
    const words = (text: string) => text.replace(/\s+/g, ' ');

    it('requires the page to carry frame-ancestors in a response header', () => {
      const text = words(spec.info.description);
      expect(text).toMatch(/\*\*The page\.\*\*/);
      expect(text).toMatch(/response header/);
      expect(text).toContain("frame-ancestors 'none'");
    });

    it('lets the client keep the token in sessionStorage only', () => {
      const text = words(spec.info.description);
      expect(text).toMatch(/`sessionStorage` of its browser tab/);
      expect(text).toMatch(/not in `localStorage`/);
      expect(text).toMatch(/no idle\s+timeout/);
    });
  });

  describe('the workflow format', () => {
    const schema = (name: string) => spec.components.schemas[name]!;
    const words = (text: string) => text.replace(/\s+/g, ' ');

    it('requires a format, a version, an intent and stages in a view', () => {
      expect(schema('WorkflowView')['required']).toEqual([
        'format',
        'version',
        'name',
        'intent',
        'stages',
      ]);
    });

    it('takes the semantic version X.Y.Z and refuses 1.1', () => {
      const version = schema('Version');
      for (const good of ['0.1.0', '1.0.0', '10.20.30']) {
        expect(valueMatchesSchema(version, good), good).toBe(true);
      }
      for (const bad of ['1.1', '1', '1.0.0.0', '01.0.0', '1.0.0-rc.1', '']) {
        expect(valueMatchesSchema(version, bad), bad).toBe(false);
      }
    });

    it('takes a path of segments that are not empty, . or .. and refuses the rest', () => {
      const path = schema('Path');
      const good = [
        'README.md',
        'docs/design.md',
        '.hidden/x',
        'a..b',
        '...',
        'a b',
        'ab:c',
        'a/b:c',
        'a/b/c.md',
        'a\u2028b',
        'a\u2029b',
      ];
      const bad = [
        '',
        '/abs',
        '/',
        '..',
        '../x',
        'a/../b',
        'a/..',
        '.',
        './README.md',
        'a/./b',
        'a/.',
        'docs/',
        'a//b.md',
        'a\\b.md',
        'C:/x.md',
        'c:x',
        'a:b.md',
        'a\nb.md',
        'a\tb.md',
        'a\u0000b',
        'a\u007fb',
        'a\u0085b',
      ];
      for (const text of good) {
        expect(valueMatchesSchema(path, text), JSON.stringify(text)).toBe(true);
      }
      for (const text of bad) {
        expect(valueMatchesSchema(path, text), JSON.stringify(text)).toBe(
          false,
        );
      }
    });

    it('links the specification for the path rule', () => {
      expect(schema('Path').description).toContain(
        'workflows-spec.md#rules-for-every-file',
      );
      expect(spec.info.description).toContain(
        'workflows-spec.md#rules-for-every-file',
      );
    });

    it('takes a check with exactly one of file and run', () => {
      const check = schema('Check');
      expect(valueMatchesSchema(check, { id: 'a', file: 'A.md' })).toBe(true);
      expect(valueMatchesSchema(check, { id: 'a', run: ['make'] })).toBe(true);
      expect(valueMatchesSchema(check, { id: 'a' })).toBe(false);
      expect(
        valueMatchesSchema(check, { id: 'a', file: 'A.md', run: ['make'] }),
      ).toBe(false);
    });

    it('lists each key of the key tables once', () => {
      const description = spec.info.description;
      const keys = [...description.matchAll(/^\s*\|\s*`([^`]+)`\s*\|/gm)]
        .map((match) => match[1] as string)
        .filter((key) => !/^[A-Z_]+$/.test(key));
      expect(keys.length).toBeGreaterThan(15);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('limits the nesting of YAML to 32 levels and reports it as unsupported', () => {
      const row = spec.info.description
        .split('\n')
        .find((line) => line.trimStart().startsWith('| `YAML_UNSUPPORTED`'));
      expect(row).toMatch(/nested deeper than 32 levels/);
      expect(row).toMatch(/The root is level 1/);
    });

    it('gives a stage of a view its kind, of the one kind this version knows', () => {
      const kind = spec.components.schemas['StageKind']!;
      expect(kind['enum']).toEqual(['agent']);
      expect(spec.components.schemas['Stage']!['required']).toEqual(
        expect.arrayContaining(['kind', 'range']),
      );
    });

    it('says that version 1.5.0 only adds the fields of a stage', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.5\.0 only adds: the answer of `GET \/api\/workflow` gains `stage_fields`/,
      );
    });

    it('says that version 1.4.0 only adds the list of agents', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.4\.0 only adds: the operation `listAgents`/,
      );
    });

    it('says that version 1.3.0 only adds the kind and the lines of a stage', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.3\.0 only adds: each stage of a view gains `kind` and `range`/,
      );
    });

    it('says what the stub does with a prompt_file', () => {
      expect(words(spec.info.description)).toMatch(
        /The stub reads no files, so it checks the path rules of a `prompt_file` and nothing else/,
      );
    });

    it('keeps the major version of the document equal to api_version', () => {
      const session = jsonBodyOf(spec, 'POST /api/session', '200');
      const { api_version: apiVersion } = session.example as {
        api_version: number;
      };
      const info = (spec as unknown as { info: { version: string } }).info;
      expect(info.version).toBe('1.13.0');
      expect(Number(info.version.split('.')[0])).toBe(apiVersion);
      const xHeader = spec.components as unknown as {
        headers: { XKonductorApi: { schema: { const: string } } };
      };
      expect(xHeader.headers.XKonductorApi.schema.const).toBe(
        String(apiVersion),
      );
    });

    it('says that the changes of this version are not additions, and why', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(/is not that kind of change/);
      expect(description).toMatch(/makes `format` required/);
      expect(description).toMatch(/limits `version` to a semantic version/);
      expect(description).toMatch(/drops the string form of `intent`/);
      expect(description).toMatch(/`api_version` stays 1/);
    });
  });

  describe('the session', () => {
    const words = (text: string) => text.replace(/\s+/g, ' ');
    const session = () =>
      jsonBodyOf(spec, 'POST /api/session', '200').example as {
        capabilities: string[];
        limits: Record<string, number>;
      };
    const schema = (name: string) => spec.components.schemas[name]!;
    const property = (name: string, key: string) =>
      (schema(name)['properties'] as Record<string, Schema>)[key]!;

    it('lists every operation of this document as a capability', () => {
      const ids = listOperations(spec).map(
        ({ operation }) => operation.operationId,
      );
      expect([...session().capabilities].sort()).toEqual([...ids].sort());
    });

    it('keeps the operationId of every pinned operation', () => {
      const ids = listOperations(spec).map(
        ({ operation }) => operation.operationId,
      );
      expect(ids).toEqual(expect.arrayContaining(STABLE_OPERATION_IDS));
      expect(session().capabilities).toEqual(
        expect.arrayContaining(STABLE_OPERATION_IDS),
      );
    });

    it('says that an operationId is not renamed within a major version', () => {
      const capabilities = property('SessionResponse', 'capabilities');
      expect(words(capabilities['description'] as string)).toMatch(
        /Each `operationId` is part of the wire contract and is not renamed within an API major version/,
      );
    });

    it('accepts every operationId as a capability', () => {
      const items = property('SessionResponse', 'capabilities')['items'] as {
        pattern: string;
      };
      for (const id of STABLE_OPERATION_IDS) {
        expect(id).toMatch(new RegExp(items.pattern));
      }
    });

    it('reports the limits that the rest of the document states', () => {
      const { limits } = session();
      const runParams = property('RunRequest', 'params')[
        'properties'
      ] as Record<string, Schema>;

      expect(limits['stages']).toBe(
        property('WorkflowView', 'stages')['maxItems'],
      );
      expect(limits['outcome_chars']).toBe(
        property('Intent', 'outcome')['maxLength'],
      );
      expect(limits['prompt_chars']).toBe(
        property('Stage', 'prompt')['maxLength'],
      );
      expect(limits['goal_chars']).toBe(runParams['goal']?.['maxLength']);
      expect(property('SaveRequest', 'text')['description']).toContain(
        `at most ${limits['text_bytes']} bytes`,
      );
    });

    it('names every limit as required', () => {
      const limits = schema('SessionLimits');
      expect([...(limits['required'] as string[])].sort()).toEqual(
        Object.keys(limits['properties'] as object).sort(),
      );
    });

    it('says that version 1.2.0 only adds to the session response', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.2\.0 only adds: the session response gains `konductor_version`, `capabilities` and `limits`/,
      );
    });

    it('says that version 1.2.1 adds and removes nothing', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.2\.1 adds nothing and removes nothing/,
      );
    });
  });

  describe('the fields of a stage', () => {
    interface Field {
      key: string;
      type: string;
      required: boolean;
      min_length?: number;
      max_length?: number;
      pattern?: string;
      reserved?: string[];
      excludes?: string[];
    }
    const loaded = () => jsonBodyOf(spec, 'GET /api/workflow', '200');
    const fieldsOf = (name: string) =>
      (namedExample(loaded(), name)['stage_fields'] as { agent: Field[] })
        .agent;
    const byKey = (key: string) =>
      fieldsOf('existing').find((f) => f.key === key)!;
    const stage = () => spec.components.schemas['Stage']!;
    const stageProperty = (key: string) =>
      (stage()['properties'] as Record<string, Schema>)[key]!;

    it('are the same whether or not the root has a file', () => {
      expect(fieldsOf('new')).toEqual(fieldsOf('existing'));
    });

    it('are the keys of a stage that the first release reads and a person edits', () => {
      expect(fieldsOf('existing').map((f) => f.key)).toEqual([
        'name',
        'agent',
        'prompt',
        'prompt_file',
      ]);
    });

    it('require the keys that a stage requires', () => {
      const required = new Set(stage()['required'] as string[]);
      for (const field of fieldsOf('existing')) {
        expect(field.required, field.key).toBe(required.has(field.key));
      }
    });

    it('hold the limits and patterns that the schemas state', () => {
      const name = spec.components.schemas['Name']!;
      const stageName = spec.components.schemas['StageName']!;
      const reserved = (
        (stageName['allOf'] as Schema[])[1]!['not'] as { enum: string[] }
      ).enum;
      expect(byKey('name').pattern).toBe(name['pattern']);
      expect(byKey('name').reserved).toEqual(reserved);
      expect(byKey('agent').pattern).toBe(name['pattern']);
      expect(byKey('prompt').min_length).toBe(
        stageProperty('prompt')['minLength'],
      );
      expect(byKey('prompt').max_length).toBe(
        stageProperty('prompt')['maxLength'],
      );
      expect(byKey('prompt_file').pattern).toBe(
        spec.components.schemas['Path']!['pattern'],
      );
      for (const key of ['name', 'agent']) {
        expect(byKey(key).max_length, key).toBe(64);
        expect('a'.repeat(64)).toMatch(new RegExp(byKey(key).pattern!));
        expect('a'.repeat(65)).not.toMatch(new RegExp(byKey(key).pattern!));
      }
    });

    it('say that prompt and prompt_file exclude each other', () => {
      expect(byKey('prompt').excludes).toEqual(['prompt_file']);
      expect(byKey('prompt_file').excludes).toEqual(['prompt']);
    });
  });

  describe('the agents', () => {
    it('lists the agents in the order of their ids, each once', () => {
      const { agents } = jsonBodyOf(spec, 'GET /api/agents', '200').example as {
        agents: { id: string }[];
      };
      const ids = agents.map((agent) => agent.id);
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).toEqual([...new Set(ids)].sort());
    });
  });

  describe('the events of a run', () => {
    interface Event {
      seq: number;
      run_id: string;
      type: string;
      stage?: string;
      status?: string;
      reason?: string;
      exit_code?: number;
    }
    interface Page {
      events: Event[];
      next: number;
      finished: boolean;
    }
    const words = (text: string) => text.replace(/\s+/g, ' ');
    const answers = () => jsonBodyOf(spec, 'GET /api/runs/{id}/events', '200');
    const page = (name: string) =>
      namedExample(answers(), name) as unknown as Page;
    const pages = () =>
      Object.keys(answers().examples ?? {}).map((name): [string, Page] => [
        name,
        page(name),
      ]);

    it('has events in the order of seq, of one run, with next after the last', () => {
      for (const [name, { events, next }] of pages()) {
        const seqs = events.map((event) => event.seq);
        expect(seqs, name).toEqual([...seqs].sort((a, b) => a - b));
        expect(new Set(events.map((e) => e.run_id)).size, name).toBeLessThan(2);
        if (events.length > 0) expect(next, name).toBe(seqs.at(-1));
      }
    });

    it('says a run is finished exactly when its run_finished has been read', () => {
      for (const [name, { events, finished }] of pages()) {
        if (events.some((e) => e.type === 'run_finished')) {
          expect(finished, name).toBe(true);
          expect(events.at(-1)?.type, name).toBe('run_finished');
        }
      }
      expect(page('running').finished).toBe(false);
    });

    it('has no console line for a run read after the grace period, so a seq can be skipped', () => {
      const { events } = page('halted');
      expect(events.some((e) => e.type === 'console')).toBe(false);
      const seqs = events.map((e) => e.seq);
      expect(seqs.at(-1)! - seqs[0]! + 1).toBeGreaterThan(seqs.length);
    });

    it('gives the state of the run when its state events are applied in order', () => {
      const run = (
        jsonBodyOf(spec, 'GET /api/runs/{id}', '200').examples!['halted']!
          .value as { run: Record<string, unknown> }
      ).run;
      const stages: Record<string, Record<string, string>> = Object.fromEntries(
        (run['order'] as string[]).map((name) => [name, { status: 'pending' }]),
      );
      let status = 'running';
      let exitCode: number | null = null;
      for (const event of page('halted').events) {
        if (event.type === 'stage_state') {
          const { status: state, reason } = event;
          stages[event.stage!] = reason
            ? { status: state!, reason }
            : { status: state! };
        } else if (event.type === 'run_finished') {
          status = event.status!;
          exitCode = event.exit_code!;
        }
      }
      expect(stages).toEqual(run['stages']);
      expect(status).toBe(run['status']);
      expect(exitCode).toBe(run['exit_code']);
    });

    it('keeps console lines live only, within 8192 bytes, and waits at most 25 seconds', () => {
      const text = words(spec.info.description);
      expect(text).toMatch(/A console line is live only/);
      expect(text).toMatch(/at most 8192 bytes of UTF-8/);
      expect(text).toMatch(/stores them nowhere/);
      expect(text).toMatch(
        /for 60 seconds after the `at` of its `run_finished`, then drops them/,
      );
      expect(text).toMatch(
        /a client that was following the run gets every line before `run_finished`/,
      );
      expect(text).toMatch(/at most 25 seconds/);
      const wait = spec.paths['/api/runs/{id}/events']![
        'get'
      ]!.parameters!.find((p) => p.name === 'wait');
      expect(wait?.schema?.['maximum']).toBe(25);
    });

    it('refuses a stage event that moves a stage to pending', () => {
      const event = spec.components.schemas['StageStateEvent']!;
      const valid = {
        seq: 1,
        run_id: '20261024-0412-a7b3c',
        at: '2026-10-24T04:12:05Z',
        type: 'stage_state',
        stage: 'write',
        status: 'running',
      };
      expect(valueMatchesSchema(event, valid)).toBe(true);
      expect(valueMatchesSchema(event, { ...valid, status: 'pending' })).toBe(
        false,
      );
    });

    describe('an event of a later type', () => {
      const runEvent = () => spec.components.schemas['RunEvent']!;
      const common = {
        seq: 7,
        run_id: '20261024-0412-a7b3c',
        at: '2026-10-24T04:12:05Z',
      };

      it('matches a run event, so a client can skip it', () => {
        const later = { ...common, type: 'stage_note', stage: 'write' };
        expect(valueMatchesSchema(runEvent(), later)).toBe(true);
      });

      it('still needs the common fields', () => {
        const noSeq = {
          run_id: common.run_id,
          at: common.at,
          type: 'stage_note',
        };
        expect(valueMatchesSchema(runEvent(), noSeq)).toBe(false);
      });

      it('does not let a known type with a bad shape through', () => {
        const badStage = {
          ...common,
          type: 'stage_state',
          stage: 'write',
          status: 'pending',
        };
        const badConsole = {
          ...common,
          type: 'console',
          stage: 'write',
          n: 0,
          text: 'x',
        };
        const badFinish = {
          ...common,
          type: 'run_finished',
          status: 'running',
          exit_code: 0,
        };
        for (const event of [badStage, badConsole, badFinish]) {
          expect(valueMatchesSchema(runEvent(), event), event.type).toBe(false);
        }
      });

      it('says a server of this version sends only the three known types', () => {
        expect(words(runEvent()['description'] as string)).toMatch(
          /A server of this version sends only the three known types/,
        );
      });
    });

    it('says that version 1.6.3 keeps console lines for a grace period', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.6\.3 adds nothing: a finished run keeps its console lines for 60 seconds/,
      );
    });

    it('says that version 1.6.2 adds a branch for a later event type', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.6\.2 adds nothing: a run event gains a branch for a type that a later version adds/,
      );
    });

    it('says that version 1.6.1 only narrows the status of a stage event', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.6\.1 adds nothing: the `status` of a `stage_state` event gets its own enum without `pending`/,
      );
    });

    it('says that version 1.6.0 only adds the events of a run', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.6\.0 only adds: the operation `getRunEvents`/,
      );
    });
  });

  describe('the history of runs', () => {
    const words = (text: string) => text.replace(/\s+/g, ' ');
    const rows = () =>
      (
        jsonBodyOf(spec, 'GET /api/runs', '200').example as {
          runs: { started_at: string; status: string }[];
        }
      ).runs;

    it('lists the newest run first', () => {
      const starts = rows().map((row) => row.started_at);
      expect(starts.length).toBeGreaterThan(1);
      expect(starts).toEqual([...starts].sort().reverse());
    });

    it('has at most one active run, the newest', () => {
      const active = rows().filter((row) => row.status === 'running');
      expect(active.length).toBeLessThan(2);
      if (active.length === 1) expect(rows()[0]).toBe(active[0]);
    });

    it('caps the list at the largest limit', () => {
      const limit = spec.paths['/api/runs']!['get']!.parameters!.find(
        (p) => p.name === 'limit',
      );
      expect(limit?.schema?.['maximum']).toBe(200);
      const list = spec.components.schemas['RunList']!['properties'] as Record<
        string,
        Schema
      >;
      expect(list['runs']!['maxItems']).toBe(200);
    });

    it('caps the goal of a run at the goal limit of the session', () => {
      const summary = spec.components.schemas['RunSummary']![
        'properties'
      ] as Record<string, Schema>;
      const session = jsonBodyOf(spec, 'POST /api/session', '200').example as {
        limits: { goal_chars: number };
      };
      expect(summary['goal']!['maxLength']).toBe(session.limits.goal_chars);
      expect(words(summary['goal']!['description'] as string)).toMatch(
        /never writes it to a log/,
      );
      expect(spec.components.schemas['RunSummary']!['required']).toContain(
        'goal_truncated',
      );
    });

    it('accepts an empty goal in a run of the list', () => {
      const summary = spec.components.schemas['RunSummary']!;
      const row = {
        run_id: '20261024-0412-a7b3c',
        started_at: '2026-10-24T04:12:05Z',
        status: 'running',
        goal: '',
        goal_truncated: false,
      };
      expect(valueMatchesSchema(summary, row)).toBe(true);
    });

    it('lists runs of the root only, and says how a client learns another run', () => {
      const description = words(
        spec.paths['/api/runs']!['get']!.description as string,
      );
      expect(description).toMatch(
        /A run of another workflow in the same workspace is not listed, even though `GET \/api\/runs\/\{id\}` can read it/,
      );
      expect(description).toMatch(/409 `already_running`/);
      expect(description).not.toMatch(/every run that/);
    });

    it('says it reads the keys of slices 1, 2 and 3a', () => {
      expect(words(spec.info.description)).toContain(
        'This version reads the keys of slices 1, 2 and 3a.',
      );
    });

    it('says what this version adds, and that it adds only', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.10\.0 only adds, in the same sense: it reads the keys of the checks, `intent\.accept\[\]\.run` and `stages\[\]\.done_when`, and a run gains `checks`/,
      );
    });

    it('says what a check of each kind means and when its declaration is wrong', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(
        /A `run` check is a command and its arguments as a list of strings, with at least one entry, run directly with no shell in the project root, and it passes when the command exits 0/,
      );
      expect(description).toMatch(
        /An id that is no check of `intent\.accept` is `INVALID_VALUE` at the entry/,
      );
      expect(description).toMatch(
        /A string as a `run` check is `WRONG_TYPE`, because `run` is a list of strings/,
      );
    });

    it('gives a param other than the goal its own, larger limit', () => {
      const description = words(spec.info.description);
      expect(description).toContain(
        'a `goal` is at most 2048 characters, and every other param of a run is at most 65536 characters (64 KiB)',
      );
      const run = spec.paths['/api/run']?.['post']?.responses?.['422'];
      const text = words(
        (run as unknown as { description: string }).description,
      );
      expect(text).toMatch(
        /a `goal` over 2048 characters or another value over 65536, a param the workflow does not declare, or a param it declares as `required`/,
      );
    });

    it('says that version 1.9.0 reads the keys that carry data between stages', () => {
      expect(spec.info.description).toMatch(
        /Version 1\.9\.0 only\s+adds, in the sense the rule means: it reads the keys that carry data\s+between stages, `stages\[\]\.outputs` and the params other than `goal`, and\s+it gives a reference in a `prompt` its meaning/,
      );
    });

    it('says that version 1.8.3 changes wording only, about which runs are listed', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.8\.3 changes wording only: it says that `GET \/api\/runs` lists the runs of the root workflow/,
      );
    });

    it('says that version 1.8.2 takes in the console grace period of 1.6.3', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.8\.2 adds nothing: it takes in the change of 1\.6\.3/,
      );
    });

    it('says that version 1.8.1 lets the goal of a run in the list be empty', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.8\.1 adds nothing: the `goal` of a run in that list may be empty/,
      );
    });

    it('says that version 1.8.0 only adds goal_truncated', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.8\.0 only adds: a run in that list gains `goal_truncated`/,
      );
    });

    it('says that version 1.7.0 only adds the history of runs', () => {
      expect(words(spec.info.description)).toMatch(
        /Version 1\.7\.0 only adds: the operation `listRuns`/,
      );
    });
  });

  describe('a run', () => {
    const schema = (name: string) => spec.components.schemas[name]!;
    const words = (text: string) => text.replace(/\s+/g, ' ');
    const REASONS = [
      'RESULT_MISSING',
      'RESULT_INVALID',
      'RESULT_FAILURE',
      'SESSION_FAILED',
      'TIMEOUT',
      'OUTPUT_MISSING',
      'OUTPUT_UNCHANGED',
      'CHECK_FAILED',
    ];

    it('takes an optional project workflow name on a run', () => {
      const request = schema('RunRequest');
      const params = { goal: 'Ship it' };
      expect(valueMatchesSchema(request, { params })).toBe(true);
      expect(valueMatchesSchema(request, { name: 'hello', params })).toBe(true);
      expect(
        valueMatchesSchema(request, { name: 'library/hello', params }),
      ).toBe(false);
    });

    it('documents root changes and stale-page refusal', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(/A successful Library copy moves the root/);
      expect(description).toMatch(
        /`POST \/api\/run` with another `name` is 403 `read_only_workflow`/,
      );
      expect(description).toMatch(/tells the person to reload/);
      expect(description).toMatch(
        /Version 1\.12\.0 only adds the optional `name` field to `POST \/api\/run`/,
      );
      const forbidden = jsonBodyOf(spec, 'POST /api/run', '403');
      expect(namedExample(forbidden, 'readOnly')).toMatchObject({
        code: 'read_only_workflow',
        error: expect.stringMatching(/Reload the page/),
      });
    });

    it('names the three harnesses, one of them for tests', () => {
      expect(schema('Harness')['enum']).toEqual(['kiro-cli', 'claude', 'fake']);
      expect(String(schema('Harness')['description'])).toMatch(
        /`fake` is for tests only/,
      );
    });

    it('has the reasons of a blocked stage, each described', () => {
      expect(schema('StageReason')['enum']).toEqual(REASONS);
      for (const reason of REASONS) {
        expect(spec.info.description, reason).toMatch(
          new RegExp(`^\\s*- \`${reason}\`: `, 'm'),
        );
      }
    });

    it('gives a blocked stage a reason, and no other stage one', () => {
      const stage = schema('RunStage');
      const ok = [
        { status: 'blocked', reason: 'TIMEOUT' },
        { status: 'passed' },
        { status: 'pending' },
        { status: 'running' },
      ];
      const bad = [
        { status: 'blocked' },
        { status: 'blocked', reason: 'OOPS' },
        { status: 'passed', reason: 'TIMEOUT' },
        { status: 'running', reason: 'TIMEOUT' },
      ];
      for (const value of ok) {
        expect(valueMatchesSchema(stage, value), JSON.stringify(value)).toBe(
          true,
        );
      }
      for (const value of bad) {
        expect(valueMatchesSchema(stage, value), JSON.stringify(value)).toBe(
          false,
        );
      }
    });

    it('passes a stage on evidence, and links the specification for it', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(
        /A stage passes on evidence, not on the exit status of its session/,
      );
      expect(description).toMatch(
        /\(\.\.\/\.\.\/docs\/design\/workflows-spec\.md#stage-result\)/,
      );
      expect(description).not.toMatch(/is `passed` when its session ends/);
    });

    it('covers a run started by any process in the workspace', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(
        /`already_running` covers a run started by any process in the workspace/,
      );
    });

    it('checks the params and trust after the workflow, and before the active run and the harness', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(
        /after the body, a malformed `name` is 400 `bad_name`, a `name` other than the root is 403 `read_only_workflow`, and then the server reads the saved file, so its remaining order is 404 for the file, then 422 `invalid_workflow`, then the params against the declaration, as 422 `bad_params`: first a param the workflow does not declare, then a param it declares as `required` with neither a value in the call nor a `default`\. After the params come 409 `trust_required`, then 409 `already_running`, then 409 `harness_unavailable`/,
      );
      const run = spec.paths['/api/run']?.['post']?.responses?.['409'];
      const text = words(
        (run as unknown as { description: string }).description,
      );
      expect(text).toMatch(
        /`trust_required`.*`already_running`.*`harness_unavailable`/,
      );
      expect(text).toMatch(/in this order/);
    });

    it('has a trust answer whose fix holds the exact command and nothing else in backticks', () => {
      const body = jsonBodyOf(spec, 'POST /api/run', '409');
      const { fix } = namedExample(body, 'untrusted') as { fix: string };
      const quoted = [...fix.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
      expect(quoted).toEqual(['konductor flow trust hello']);
      expect(namedExample(body, 'untrusted')['code']).toBe('trust_required');
    });

    it('ends the trust of a workflow with any save that changes its bytes', () => {
      const description = words(spec.info.description);
      expect(description).toMatch(/never grants it or moves a trust record/);
      expect(description).toMatch(
        /A save that changes the bytes of the workflow ends its trust/,
      );
      expect(description).toMatch(/a prompt, a param/);
      expect(description).not.toMatch(/changes the `agent` of a stage, or/);
    });

    it('has no operation that grants trust', () => {
      const paths = Object.keys(spec.paths).join(' ');
      expect(paths).not.toMatch(/trust/);
      expect(words(spec.info.description)).toMatch(
        /no operation that grants trust/,
      );
    });

    it('has an answer for a missing claude as well as for kiro-cli', () => {
      const body = jsonBodyOf(spec, 'POST /api/run', '409');
      expect(namedExample(body, 'missingClaude')).toMatchObject({
        code: 'harness_unavailable',
      });
      expect(namedExample(body, 'missingHarness')).toMatchObject({
        code: 'harness_unavailable',
      });
    });
  });

  describe('the checks themselves', () => {
    it('accepts a running run between two stages', () => {
      const [answer] = valuesFor(
        cases,
        spec.components.schemas['RunStatusResponse']!,
      );
      const between = {
        ...(answer!['run'] as Record<string, unknown>),
        order: ['write'],
        stages: { write: { status: 'passed' } },
      };
      expect(runProblems(between)).toEqual([]);
    });

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
