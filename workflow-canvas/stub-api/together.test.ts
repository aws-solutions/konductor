// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  environmentOf,
  runTogether,
  type Command,
  type TogetherDeps,
} from './together.ts';

const node = (script: string, env?: NodeJS.ProcessEnv): Command => ({
  file: process.execPath,
  args: ['-e', script],
  env,
});
// Runs until it is stopped, and exits cleanly when asked to.
const FOREVER = `setInterval(() => {}, 1 << 30);
process.on('SIGTERM', () => process.exit(0));`;

describe('runTogether', () => {
  it('stops the others when one exits, and reports its code', async () => {
    const { done } = runTogether([node('process.exit(3)'), node(FOREVER)]);
    expect(await done).toBe(3);
  });

  it('reports 0 when every command succeeds', async () => {
    const { done } = runTogether([node(''), node('')]);
    expect(await done).toBe(0);
  });

  it('stops every command on stop, and that is not a failure', async () => {
    const { stop, done } = runTogether([node(FOREVER), node(FOREVER)]);
    stop();
    expect(await done).toBe(0);
  });

  it('counts a command that dies of another signal as a failure', async () => {
    const { done } = runTogether([
      node(`process.kill(process.pid, 'SIGKILL')`),
      node(FOREVER),
    ]);
    expect(await done).toBe(1);
  });

  it('counts a command that cannot start as a failure', async () => {
    const { done } = runTogether([
      { file: '/no/such/command', args: [] },
      node(FOREVER),
    ]);
    expect(await done).toBe(1);
  });

  it('gives each command its own environment', async () => {
    const check = `process.exit(process.env.TOGETHER_X === 'on' ? 0 : 7)`;
    const { done } = runTogether([node(check, { TOGETHER_X: 'on' })]);
    expect(await done).toBe(0);
  });
});

describe('runTogether escalation', () => {
  // Ignores SIGTERM, and tells its parent over IPC once it does.
  const IGNORES_TERM = `process.on('SIGTERM', () => {});
process.send?.('ready'); setInterval(() => {}, 1 << 30);`;

  /** Deps whose timer waits for the test to fire it, and that record children. */
  function manualDeps() {
    const children: ChildProcess[] = [];
    const timers: Array<{ run: () => void; ms: number; cancel: () => void }> =
      [];
    const deps: TogetherDeps = {
      graceMs: 1234,
      // An IPC channel lets a child tell the test that it is ready.
      spawn: ((file: string, args: string[], options: object) => {
        const child = spawn(file, args, {
          ...options,
          stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });
        children.push(child);
        return child;
      }) as typeof spawn,
      schedule: (run, ms) => {
        const cancel = vi.fn();
        timers.push({ run, ms, cancel });
        return cancel;
      },
    };
    return { deps, children, timers };
  }

  it('kills a command that ignores SIGTERM once the grace time is over', async () => {
    const { deps, children, timers } = manualDeps();
    const { stop, done } = runTogether([node(IGNORES_TERM)], deps);
    await once(children[0]!, 'message');

    stop();
    stop();

    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(1234);
    expect(children[0]?.signalCode).toBeNull();
    timers[0]?.run();
    await done;
    expect(children[0]?.signalCode).toBe('SIGKILL');
  });

  it('does not kill commands that exit on SIGTERM, and drops the timer', async () => {
    const { deps, timers } = manualDeps();
    const { stop, done } = runTogether([node(FOREVER), node(FOREVER)], deps);

    stop();
    await done;

    expect(timers).toHaveLength(1);
    expect(timers[0]?.cancel).toHaveBeenCalledTimes(1);
  });

  it('starts no timer once every command has exited', async () => {
    const { deps, timers } = manualDeps();
    const { stop, done } = runTogether([node('')], deps);
    await done;
    timers.length = 0;

    stop();

    expect(timers).toHaveLength(0);
  });
});

describe('the environment of a command', () => {
  it('is the base environment with the variables of the command on top', () => {
    const command = { file: 'x', args: [], env: { A: '', B: 'new' } };
    expect(environmentOf(command, { A: 'old', B: 'old', C: 'kept' })).toEqual({
      A: '',
      B: 'new',
      C: 'kept',
    });
  });
});
