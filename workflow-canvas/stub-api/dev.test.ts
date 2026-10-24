// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devCommands, startDev } from './dev.ts';
import { apiTarget } from './target.ts';
import { environmentOf, type Together } from './together.ts';

const [stub, vite] = devCommands();
const entry = (command: typeof stub) => command?.args.at(-1) ?? '';

describe('the dev:stub commands', () => {
  it('start the stub and Vite with the same node', () => {
    expect(devCommands()).toHaveLength(2);
    expect(stub?.file).toBe(process.execPath);
    expect(vite?.file).toBe(process.execPath);
  });

  it('point at files that exist', () => {
    expect(
      existsSync(fileURLToPath(new URL('./main.ts', import.meta.url))),
    ).toBe(true);
    expect(existsSync(entry(vite))).toBe(true);
    expect(entry(vite)).toMatch(/vite[\\\\/]bin[\\\\/]vite\.js$/);
  });

  it('tell the stub that the dev server runs beside it', () => {
    expect(stub?.args.at(-1)).toBe('--with-dev-server');
    expect(stub?.args.at(-2)).toMatch(/main\.ts$/);
  });

  it('give Vite no WC_API_TARGET, whatever the shell has', () => {
    const shell = { WC_API_TARGET: 'http://127.0.0.1:8080', KEEP: 'yes' };

    const env = environmentOf(vite!, shell);

    expect(apiTarget(env).isStub).toBe(true);
    expect(env.KEEP).toBe('yes');
  });

  it('leave the environment of the stub alone', () => {
    expect(stub?.env).toBeUndefined();
  });
});

describe('startDev', () => {
  const before = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };

  /** Removes the signal listeners that `startDev` added, and only those. */
  afterEach(() => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!before[signal].includes(listener)) process.off(signal, listener);
      }
    }
  });

  it('runs the dev commands and stops them on SIGINT and SIGTERM', () => {
    const together: Together = { stop: vi.fn(), done: Promise.resolve(0) };
    const run = vi.fn(() => together);

    expect(startDev(run)).toBe(together);
    expect(run).toHaveBeenCalledWith(devCommands());

    process.emit('SIGINT');
    process.emit('SIGTERM');

    expect(together.stop).toHaveBeenCalledTimes(2);
  });
});
