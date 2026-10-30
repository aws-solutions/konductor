// SPDX-License-Identifier: Apache-2.0
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Clock } from '../core/clock.ts';
import { ApiError } from '../core/errors.ts';
import { RunSimulator } from '../core/runs.ts';
import {
  FIXTURES,
  SAMPLE_FILES,
  SAMPLE_ROOT,
  type Behavior,
} from '../core/sample.ts';
import { WorkflowStore } from '../core/store.ts';
import { WorkflowApi } from '../core/workflow-api.ts';
import { DEFAULT_PORT, LOOPBACK, originOf } from '../address.ts';
import { dispatch, type Dispatcher } from './dispatch.ts';
import { errorReply, faultReply, send } from './respond.ts';
import { buildRoutes } from './routes.ts';
import { SessionGate } from './session.ts';
import { newRunSuffix, newSecret, systemClock } from './system.ts';

export interface StubOptions {
  /** `0` picks a free port. */
  port?: number;
  launchCode?: string;
  /** Lets the launch code be traded again; see `SessionGateOptions`. */
  reusableLaunchCode?: boolean;
  clock?: Clock;
  runSuffix?: () => string;
  /** How long each simulated stage takes. */
  stageMs?: number;
  /** The workflow files at the start, by name. */
  files?: Readonly<Record<string, string>>;
  /** The workflow of the session. It is `hello`, which runs and passes. */
  root?: string;
  /** How a run is answered. The default is that of the fixture of the root. */
  behavior?: Behavior;
}

export interface RunningStub {
  /** The address the socket is bound to, as the operating system reports it. */
  host: string;
  port: number;
  origin: string;
  launchCode: string;
  close(): Promise<void>;
}

/** Starts the stub on the loopback address and resolves once it listens. */
export async function startStub(
  options: StubOptions = {},
): Promise<RunningStub> {
  const clock = options.clock ?? systemClock;
  const launchCode = options.launchCode ?? newSecret();
  const root = options.root ?? SAMPLE_ROOT;
  const api = new WorkflowApi({
    root,
    behavior: options.behavior ?? FIXTURES[root]?.behavior,
    store: new WorkflowStore(options.files ?? SAMPLE_FILES),
    runs: new RunSimulator({
      clock,
      suffix: options.runSuffix ?? newRunSuffix,
      stageMs: options.stageMs,
    }),
  });
  const session = new SessionGate({
    clock,
    launchCode,
    reusableLaunchCode: options.reusableLaunchCode,
  });
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
  session.openWindow();
  const { address, port } = server.address() as AddressInfo;
  return {
    host: address,
    port,
    origin: originOf(port),
    launchCode,
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
