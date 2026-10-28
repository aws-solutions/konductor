// SPDX-License-Identifier: Apache-2.0
import { API_VERSION, HARNESS } from '../core/contract.ts';
import { badName } from '../core/errors.ts';
import type { WorkflowApi } from '../core/workflow-api.ts';
import {
  readCheckRequest,
  readRunRequest,
  readSaveRequest,
  readSessionRequest,
} from './readers.ts';
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
  /** Whether the call needs the session token. */
  secured: boolean;
  handle(call: Call): Reply;
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

/** The six operations of the contract, on the paths it gives them. */
export function buildRoutes(api: WorkflowApi, session: SessionGate): Route[] {
  return [
    {
      pattern: /^\/api\/session$/,
      operations: {
        POST: {
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
            });
          },
        },
      },
    },
    {
      pattern: /^\/api\/workflow$/,
      operations: {
        GET: {
          secured: true,
          handle: ({ query }) => ok(api.loadWorkflow(nameFrom(query))),
        },
        PUT: {
          secured: true,
          handle: ({ body }) => ok(api.saveWorkflow(readSaveRequest(body))),
        },
      },
    },
    {
      pattern: /^\/api\/validate$/,
      operations: {
        POST: {
          secured: true,
          handle: ({ body }) => ok(api.checkWorkflow(readCheckRequest(body))),
        },
      },
    },
    {
      pattern: /^\/api\/run$/,
      operations: {
        POST: {
          secured: true,
          handle: ({ body }) => {
            readRunRequest(body);
            return { status: 202, body: api.startRun() };
          },
        },
      },
    },
    {
      pattern: /^\/api\/runs\/([^/]+)$/,
      operations: {
        GET: {
          secured: true,
          handle: ({ params }) => ok({ run: api.getRun(params[0] ?? '') }),
        },
      },
    },
  ];
}
