// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach } from 'vitest';
import {
  startStub,
  type RunningStub,
  type StubOptions,
} from '../http/server.ts';
import { countingSuffix, FakeClock } from './fake-clock.ts';
import { StubClient } from './stub-client.ts';

export const LAUNCH_CODE = 'test-launch-code';

/** A stub on a free port, with a clock and a client that belong to it. */
export interface TestStub {
  stub: RunningStub;
  clock: FakeClock;
  client: StubClient;
}

/** Starts a stub whose clock and run ids the test controls. */
export async function openStub(options: StubOptions = {}): Promise<TestStub> {
  const clock = new FakeClock();
  const stub = await startStub({
    port: 0,
    launchCode: LAUNCH_CODE,
    clock,
    runSuffix: countingSuffix(),
    ...options,
  });
  return { stub, clock, client: new StubClient(stub.port) };
}

/** Trades the launch code for a token and keeps it on the client. */
export async function signIn({ client }: TestStub): Promise<void> {
  const reply = await client.post('/api/session', { code: LAUNCH_CODE });
  client.token = (reply.body as { token: string }).token;
}

/**
 * Gives each test in the enclosing `describe` its own stub, signed in unless
 * `signedIn` is false, and stops it afterwards.
 */
export function useStub(
  options: StubOptions = {},
  signedIn = true,
): () => TestStub {
  let current: TestStub | undefined;
  beforeEach(async () => {
    current = await openStub(options);
    if (signedIn) await signIn(current);
  });
  afterEach(async () => {
    await current?.stub.close();
  });
  return () => {
    if (!current) throw new Error('useStub: no test is running');
    return current;
  };
}
