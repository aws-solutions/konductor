// SPDX-License-Identifier: Apache-2.0
import { spawn, type ChildProcess } from 'node:child_process';

/** A command to run beside the others, with the environment it gets. */
export interface Command {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

/** Commands that run together: `stop` ends them all, `done` is the exit code. */
export interface Together {
  stop: () => void;
  done: Promise<number>;
}

const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

/** The exit code of a child. Being stopped by a stop signal is not a failure. */
function exitCodeOf(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (code !== null) return code;
  return signal && STOP_SIGNALS.includes(signal) ? 0 : 1;
}

/**
 * Runs the commands with the terminal's output. When one exits, or `stop` is
 * called, the rest get SIGTERM. `done` settles once every command has exited,
 * with the code of the first one to exit, or 0 after a `stop`.
 */
export function runTogether(commands: Command[]): Together {
  const children = commands.map(({ file, args, env }) =>
    spawn(file, args, { stdio: 'inherit', env: { ...process.env, ...env } }),
  );
  let firstCode: number | undefined;

  const stop = (): void => terminate(children);
  const done = Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          child.once('error', () => {
            firstCode ??= 1;
            stop();
            resolve();
          });
          child.once('close', (code, signal) => {
            firstCode ??= exitCodeOf(code, signal);
            stop();
            resolve();
          });
        }),
    ),
  ).then(() => firstCode ?? 0);

  return { stop, done };
}

function terminate(children: ChildProcess[]): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
    }
  }
}
