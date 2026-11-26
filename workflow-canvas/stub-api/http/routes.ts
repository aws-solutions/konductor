// SPDX-License-Identifier: Apache-2.0
import {
  API_VERSION,
  HARNESS,
  KONDUCTOR_VERSION,
  SESSION_LIMITS,
} from '../core/contract.ts';
import { badName } from '../core/errors.ts';
import type { WorkflowApi } from '../core/workflow-api.ts';
import {
  readCheckRequest,
  readLibraryCopyRequest,
  readRunRequest,
  readSaveRequest,
  readSessionRequest,
} from './readers.ts';
import { readLimit } from './queries.ts';
import { followRunEvents, readEventsQuery, type Waiter } from './run-events.ts';
import type { SessionGate } from './session.ts';

/** What a handler answers with, before it is written to the socket. */
export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface Call {
  query: URLSearchParams;
  /** The parts of the path that the route pattern captured. */
  params: string[];
  /** The parsed body of a PUT or POST. */
  body: unknown;
}

export interface Operation {
  /** The `operationId` of the call in the contract. */
  id: string;
  /** Whether the call needs the session token. */
  secured: boolean;
  handle(call: Call): Reply | Promise<Reply>;
}

export interface Route {
  pattern: RegExp;
  /** The operations of the path, by HTTP method. */
  operations: Record<string, Operation>;
}

const ok = (body: unknown): Reply => ({ status: 200, body });

// A `name` that is repeated in the query is as bad as one that is not a name.
function nameFrom(query: URLSearchParams): string | undefined {
  const names = query.getAll('name');
  if (names.length > 1) {
    throw badName();
  }
  return names[0];
}

function libraryNameOf(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw badName();
  }
}

/** The `operationId` of every operation that `routes` serves. */
function capabilitiesOf(routes: Route[]): string[] {
  return routes.flatMap((route) =>
    Object.values(route.operations).map((operation) => operation.id),
  );
}

/** The operations of the contract, on the paths it gives them. */
export function buildRoutes(
  api: WorkflowApi,
  session: SessionGate,
  waiter: Waiter,
): Route[] {
  const routes: Route[] = [
    {
      pattern: /^\/api\/session$/,
      operations: {
        POST: {
          id: 'createSession',
          secured: false,
          handle: ({ body }) => {
            const { code } = readSessionRequest(body);
            const token = session.exchange(code);
            const { root } = api;
            return ok({
              token,
              root,
              harness: HARNESS,
              api_version: API_VERSION,
              konductor_version: KONDUCTOR_VERSION,
              capabilities: capabilitiesOf(routes),
              limits: SESSION_LIMITS,
            });
          },
        },
      },
    },
    {
      pattern: /^\/api\/workflow$/,
      operations: {
        GET: {
          id: 'getWorkflow',
          secured: true,
          handle: ({ query }) => ok(api.loadWorkflow(nameFrom(query))),
        },
        PUT: {
          id: 'saveWorkflow',
          secured: true,
          handle: ({ body }) => ok(api.saveWorkflow(readSaveRequest(body))),
        },
      },
    },
    {
      pattern: /^\/api\/library$/,
      operations: {
        GET: {
          id: 'listLibrary',
          secured: true,
          handle: () => ok(api.listLibrary()),
        },
      },
    },
    {
      pattern: /^\/api\/library\/([^/]+)$/,
      operations: {
        GET: {
          id: 'getLibraryWorkflow',
          secured: true,
          handle: ({ params }) =>
            ok(api.loadLibrary(libraryNameOf(params[0] ?? ''))),
        },
      },
    },
    {
      pattern: /^\/api\/library\/([^/]+)\/copy$/,
      operations: {
        POST: {
          id: 'copyLibraryWorkflow',
          secured: true,
          handle: ({ params, body }) => {
            const request = readLibraryCopyRequest(body);
            return ok(
              api.copyLibrary(libraryNameOf(params[0] ?? ''), request.as),
            );
          },
        },
      },
    },
    {
      pattern: /^\/api\/validate$/,
      operations: {
        POST: {
          id: 'checkWorkflow',
          secured: true,
          handle: ({ body }) => ok(api.checkWorkflow(readCheckRequest(body))),
        },
      },
    },
    {
      pattern: /^\/api\/run$/,
      operations: {
        POST: {
          id: 'startRun',
          secured: true,
          handle: ({ body }) => {
            const { name, params } = readRunRequest(body);
            return { status: 202, body: api.startRun(name, params) };
          },
        },
      },
    },
    {
      pattern: /^\/api\/runs\/([^/]+)$/,
      operations: {
        GET: {
          id: 'getRun',
          secured: true,
          handle: ({ params }) => ok({ run: api.getRun(params[0] ?? '') }),
        },
      },
    },
    {
      pattern: /^\/api\/runs$/,
      operations: {
        GET: {
          id: 'listRuns',
          secured: true,
          handle: ({ query }) => ok(api.listRuns(readLimit(query))),
        },
      },
    },
    {
      pattern: /^\/api\/runs\/([^/]+)\/events$/,
      operations: {
        GET: {
          id: 'getRunEvents',
          secured: true,
          handle: async ({ params, query }) => {
            const read = readEventsQuery(query);
            const runId = params[0] ?? '';
            return ok(await followRunEvents(api, runId, read, waiter));
          },
        },
      },
    },
    {
      pattern: /^\/api\/agents$/,
      operations: {
        GET: {
          id: 'listAgents',
          secured: true,
          handle: () => ok(api.listAgents()),
        },
      },
    },
  ];
  return routes;
}
