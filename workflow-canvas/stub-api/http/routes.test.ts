// SPDX-License-Identifier: Apache-2.0
/** Checks that the stub routes every operation of api/openapi.yaml, and nothing else. */
import { describe, expect, it } from 'vitest';
import type { WorkflowApi } from '../core/workflow-api.ts';
import { contractOperations } from '../test-support/contract.ts';
import { buildRoutes, type Route } from './routes.ts';
import type { SessionGate } from './session.ts';

// The table is read, not called, so the handlers never reach these.
const routes = buildRoutes({} as WorkflowApi, {} as SessionGate);
const operations = contractOperations();

// A concrete path for a template, with each `{param}` filled in.
const samplePath = (template: string) =>
  template.replaceAll(/\{[^}]+\}/g, 'sample-0');

function routeFor(path: string): Route | undefined {
  return routes.find((route) => route.pattern.test(path));
}

describe('the routes of the stub and api/openapi.yaml', () => {
  it('documents at least one operation', () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  it.each(operations.map((op) => [`${op.method} ${op.path}`, op] as const))(
    'routes %s',
    (_name, { method, path }) => {
      const route = routeFor(samplePath(path));

      expect(route, `no stub route matches ${path}`).toBeDefined();
      expect(Object.keys(route?.operations ?? {})).toContain(method);
    },
  );

  it.each(operations.map((op) => [`${op.method} ${op.path}`, op] as const))(
    'asks for the session token on %s exactly when the contract does',
    (_name, { method, path, secured }) => {
      expect(routeFor(samplePath(path))?.operations[method]?.secured).toBe(
        secured,
      );
    },
  );

  it.each(operations.map((op) => [`${op.method} ${op.path}`, op] as const))(
    'gives %s the operationId of the contract',
    (_name, { id, method, path }) => {
      expect(routeFor(samplePath(path))?.operations[method]?.id).toBe(id);
    },
  );

  it('documents every route the stub serves', () => {
    const served = routes.flatMap((route) =>
      Object.keys(route.operations).map((method) => {
        const documented = operations.find(
          (op) =>
            op.method === method && route.pattern.test(samplePath(op.path)),
        );
        return documented
          ? `${method} ${documented.path}`
          : `${method} ${route.pattern.source} (not in api/openapi.yaml)`;
      }),
    );

    expect(served.sort()).toEqual(
      operations.map((op) => `${op.method} ${op.path}`).sort(),
    );
  });

  it('matches each documented path with one route only', () => {
    for (const { path } of operations) {
      const matching = routes.filter((route) =>
        route.pattern.test(samplePath(path)),
      );
      expect(matching, path).toHaveLength(1);
    }
  });
});
