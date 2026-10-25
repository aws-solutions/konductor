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

// The line numbers, from 1, of the lines of a text that start with a prefix.
function linesStartingWith(text: string, prefix: string): number[] {
  return text
    .split('\n')
    .flatMap((line, index) => (line.startsWith(prefix) ? [index + 1] : []));
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

// An example answer and the workflow text it is an answer about.
interface TextAndAnswer {
  label: string;
  text: string;
  answer: Record<string, unknown>;
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
  return [...checks, ...loads, saved, refused];
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

      it('has a diagnostic that points at the name in its message', () => {
        const found = pairs.flatMap(({ label, text, answer }) =>
          (answer['diagnostics'] as Record<string, unknown>[]).map((d) => ({
            label: `${label}: ${String(d['message'])}`,
            pointedAt: textBetween(text, d),
            quoted: quotedIn(String(d['message'])),
          })),
        );
        expect(found.length).toBeGreaterThan(0);
        for (const { label, pointedAt, quoted } of found) {
          expect(pointedAt, label).toBe(quoted);
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
