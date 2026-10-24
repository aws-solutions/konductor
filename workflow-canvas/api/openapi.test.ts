// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
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
interface Body {
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
  requestBody?: Body;
  responses?: Record<string, Body>;
}
interface Spec {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

interface Case {
  label: string;
  schema: Schema;
  value: unknown;
}

const SPEC_FILE = fileURLToPath(new URL('./openapi.yaml', import.meta.url));
const HTTP_METHODS = ['get', 'put', 'post', 'patch', 'delete'];

// The first release has these five operations and no others.
const MVP_OPERATIONS = [
  'GET /api/workflow getWorkflow',
  'PUT /api/workflow saveWorkflow',
  'POST /api/validate checkWorkflow',
  'POST /api/run startRun',
  'GET /api/runs/{id} getRun',
];

const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));

function valueMatchesSchema(schema: Schema, value: unknown): boolean {
  return ajv.compile(schema)(value);
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

function casesOf(label: string, schema: Schema | undefined, source: Example) {
  const values = exampleValues(source);
  return values.map((value, index) => ({
    label: `${label} example ${index + 1}`,
    schema: schema ?? {},
    value,
  }));
}

function mediaTypesOf(body: Body | undefined, label: string) {
  return Object.entries(body?.content ?? {}).map(([type, media]) => ({
    label: `${label} ${type}`,
    media,
  }));
}

function listMediaTypes(spec: Spec) {
  return listOperations(spec).flatMap(({ method, path, operation }) => {
    const where = `${method} ${path}`;
    const responses = Object.entries(operation.responses ?? {}).flatMap(
      ([status, response]) => mediaTypesOf(response, `${where} ${status}`),
    );
    return [
      ...mediaTypesOf(operation.requestBody, `${where} request`),
      ...responses,
    ];
  });
}

function listCases(spec: Spec): Case[] {
  const parameters = listOperations(spec).flatMap(
    ({ method, path, operation }) =>
      (operation.parameters ?? []).flatMap((p) =>
        casesOf(`${method} ${path} parameter ${p.name}`, p.schema, p),
      ),
  );
  const bodies = listMediaTypes(spec).flatMap(({ label, media }) =>
    casesOf(label, media.schema, media),
  );
  return [...parameters, ...bodies];
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

  it('is an OpenAPI 3.1 document', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it('has the five operations of the first release and no others', () => {
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
    for (const { label, media } of listMediaTypes(spec)) {
      expect(exampleValues(media).length, label).toBeGreaterThan(0);
    }
  });

  it('answers every error status with the one Error schema', () => {
    const errorSchema = spec.components.schemas['Error'];
    const errorBodies = listOperations(spec).flatMap(({ operation }) =>
      Object.entries(operation.responses ?? {})
        .filter(([status]) => Number(status) >= 400)
        .flatMap(([status, response]) =>
          mediaTypesOf(response, status).map(({ media }) => media.schema),
        ),
    );
    expect(errorBodies.length).toBeGreaterThan(0);
    for (const schema of errorBodies) {
      expect(schema).toBe(errorSchema);
    }
  });

  it('has examples to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it('has examples that match their schema', () => {
    const mismatches = cases
      .filter(({ schema, value }) => !valueMatchesSchema(schema, value))
      .map(({ label }) => label);
    expect(mismatches).toEqual([]);
  });

  it('rejects an example that does not match its schema', () => {
    const run = spec.components.schemas['Run'] as Schema;
    const broken = { run_id: 'not-a-run-id' };
    expect(valueMatchesSchema(run, broken)).toBe(false);
  });
});
