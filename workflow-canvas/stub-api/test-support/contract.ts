// SPDX-License-Identifier: Apache-2.0
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { Reply } from './stub-client.ts';

type Json = Record<string, unknown>;
interface Media {
  schema?: Json;
  example?: unknown;
  examples?: Record<string, { value: unknown }>;
}
interface Operation {
  requestBody?: { content: Record<string, Media> };
  responses: Record<string, { content?: Record<string, Media> }>;
}
interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Json> };
}

const SPEC_FILE = fileURLToPath(
  new URL('../../api/openapi.yaml', import.meta.url),
);
const spec = (await SwaggerParser.dereference(SPEC_FILE)) as unknown as Spec;
const ajv = addFormats(new Ajv2020({ strict: true, allowUnionTypes: true }));

function operationOf(method: string, path: string): Operation {
  const operation = spec.paths[path]?.[method.toLowerCase()];
  if (!operation) throw new Error(`api/openapi.yaml has no ${method} ${path}`);
  return operation;
}

function expectBodyToMatch(schema: Json | undefined, body: unknown): void {
  expect(schema, 'the contract gives a schema for this body').toBeDefined();
  const validate = ajv.compile(schema ?? {});
  const valid = validate(body);
  expect(
    valid,
    `${ajv.errorsText(validate.errors)} in ${JSON.stringify(body)}`,
  ).toBe(true);
}

function expectVersionHeaders(reply: Reply): void {
  expect(reply.headers['x-konductor-api']).toBe('1');
  expect(reply.headers['cache-control']).toBe('no-store');
  expect(reply.headers['content-type']).toBe('application/json');
  expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  expect(reply.headers['set-cookie']).toBeUndefined();
}

/**
 * Checks a reply against api/openapi.yaml: the operation declares its status,
 * and the body matches the schema of that response.
 */
export function expectContract(
  reply: Reply,
  method: string,
  path: string,
): void {
  const declared = operationOf(method, path).responses[String(reply.status)];
  expect(declared, `${method} ${path} declares ${reply.status}`).toBeDefined();
  expectVersionHeaders(reply);
  expectBodyToMatch(
    declared?.content?.['application/json']?.schema,
    reply.body,
  );
}

/** Checks an error that the contract names for every path, such as a 404. */
export function expectError(reply: Reply, status: number, code: string): void {
  expect(reply.status).toBe(status);
  expectVersionHeaders(reply);
  expectBodyToMatch(spec.components.schemas.Error, reply.body);
  expect(reply.body).toMatchObject({ code });
}

/** The named request example of an operation. */
export function requestExample(
  method: string,
  path: string,
  name: string,
): unknown {
  const media = operationOf(method, path).requestBody?.content[
    'application/json'
  ];
  return media?.examples?.[name]?.value ?? media?.example;
}

/** The example of a response, by status and name. */
export function responseExample(
  method: string,
  path: string,
  status: number,
  name?: string,
): unknown {
  const media = operationOf(method, path).responses[String(status)]?.content?.[
    'application/json'
  ];
  return name === undefined ? media?.example : media?.examples?.[name]?.value;
}

/** The names of the response examples of an operation and status. */
export function responseExampleNames(
  method: string,
  path: string,
  status: number,
): string[] {
  const media = operationOf(method, path).responses[String(status)]?.content?.[
    'application/json'
  ];
  return Object.keys(media?.examples ?? {});
}
