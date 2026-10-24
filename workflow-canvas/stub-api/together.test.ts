// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { runTogether, type Command } from './together.ts';

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
