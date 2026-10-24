// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Clock } from '../core/clock.ts';
import { ApiError } from '../core/errors.ts';
import { RunSimulator } from '../core/runs.ts';
import { SAMPLE_FILES, SAMPLE_ROOT } from '../core/sample.ts';
import { WorkflowStore } from '../core/store.ts';
import { WorkflowApi } from '../core/workflow-api.ts';
import { dispatch, type Dispatcher } from './dispatch.ts';
import { errorReply, faultReply, send } from './respond.ts';
import { buildRoutes } from './routes.ts';
import { SessionGate } from './session.ts';
import { newRunSuffix, newSecret, systemClock } from './system.ts';

/** The port of the server URL in the contract. */
export const DEFAULT_PORT = 5174;
/** The stub listens here and nowhere else. */
export const LOOPBACK = '127.0.0.1';

export interface StubOptions {
  /** `0` picks a free port. */
  port?: number;
  launchCode?: string;
  clock?: Clock;
  runSuffix?: () => string;
  /** How long each simulated stage takes. */
  stageMs?: number;
  /** The workflow files at the start, by name. */
  files?: Readonly<Record<string, string>>;
}

export interface RunningStub {
  port: number;
  origin: string;
  launchCode: string;
  /** The address to open, with the launch code in the fragment. */
  launchAddress: string;
  close(): Promise<void>;
}

/** Starts the stub on the loopback address and resolves once it listens. */
export async function startStub(
  options: StubOptions = {},
): Promise<RunningStub> {
  const clock = options.clock ?? systemClock;
  const launchCode = options.launchCode ?? newSecret();
  const api = new WorkflowApi({
    root: SAMPLE_ROOT,
    store: new WorkflowStore(options.files ?? SAMPLE_FILES),
    runs: new RunSimulator({
      clock,
      suffix: options.runSuffix ?? newRunSuffix,
      stageMs: options.stageMs,
    }),
  });
  const session = new SessionGate({ clock, launchCode });
  const dispatcher: Dispatcher = {
    routes: buildRoutes(api, session),
    session,
    port: () => portOf(server),
  };
  const server = createServer((req, res) => {
    dispatch(req, dispatcher)
      .catch((error: unknown) => {
        if (error instanceof ApiError) return errorReply(error);
        console.error(error);
        return faultReply();
      })
      .then((reply) => send(res, reply));
  });
  await listen(server, options.port ?? DEFAULT_PORT);
  const port = portOf(server);
  const origin = `http://${LOOPBACK}:${port}`;
  return {
    port,
    origin,
    launchCode,
    launchAddress: `${origin}/#${launchCode}`,
    close: () => close(server),
  };
}

function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
}
