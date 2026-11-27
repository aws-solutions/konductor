// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach } from 'vitest';
import {
  startStub,
  type RunningStub,
  type StubOptions,
} from '../http/server.ts';
import { countingSuffix, FakeClock } from './fake-clock.ts';
import { NotApplicable, SERVER_BIN, startRealServer } from './real-server.ts';
import { skipAgainstRealServer } from './real-server-skips.ts';
import { StubClient } from './stub-client.ts';

export const LAUNCH_CODE = 'test-launch-code';

/** A stub on a free port, with a clock and a client that belong to it. */
export interface TestStub {
  stub: Pick<RunningStub, 'host' | 'port' | 'origin' | 'launchCode' | 'close'>;
  clock: FakeClock;
  client: StubClient;
}

/** Starts a stub whose clock and run ids the test controls. */
export async function openStub(options: StubOptions = {}): Promise<TestStub> {
  if (SERVER_BIN) return openRealServer(SERVER_BIN, options);
  const clock = new FakeClock();
  const stub = await startStub({
    port: 0,
    launchCode: LAUNCH_CODE,
    clock,
    runSuffix: countingSuffix(),
    // A long poll moves the fake clock instead of waiting.
    pause: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    ...options,
  });
  return { stub, clock, client: new StubClient(stub.port) };
}

/**
 * The clock of a test against the real server. The stub's tests move time to
 * let a run get on, so here moving time waits for the fake harness, which
 * finishes a run in a moment.
 */
class SettleClock extends FakeClock {
  override advance(): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  }
}

// Options that steer the stub's own simulation. The real server has no twin for
// them: its clock, its run ids and its trust are the real ones.
const STUB_ONLY = [
  'clock',
  'runSuffix',
  'stageMs',
  'reusableLaunchCode',
  'port',
] as const;

async function openRealServer(
  bin: string,
  options: StubOptions,
): Promise<TestStub> {
  if (STUB_ONLY.some((key) => options[key] !== undefined)) {
    throw new NotApplicable('the test steers the stub');
  }
  const server = await startRealServer(bin, {
    ...options,
    launchCode: LAUNCH_CODE,
  });
  return {
    stub: server,
    clock: new SettleClock(),
    client: new StubClient(server.port),
  };
}

/** Trades the launch code for a token and keeps it on the client. */
export async function signIn({ client, stub }: TestStub): Promise<void> {
  const reply = await client.post('/api/session', {
    code: stub.launchCode,
  });
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
  beforeEach(async (context) => {
    if (SERVER_BIN) {
      const reason = skipAgainstRealServer(context.task);
      if (reason) return context.skip(reason);
    }
    try {
      current = await openStub(options);
    } catch (error) {
      // The test needs the stub's own controls, which the real server lacks.
      if (error instanceof NotApplicable) return context.skip(error.message);
      throw error;
    }
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
