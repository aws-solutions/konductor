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

/** The parts of `runTogether` that a test replaces. */
export interface TogetherDeps {
  spawn: typeof spawn;
  /** Runs `run` once after `ms`, and returns a function that cancels it. */
  schedule: (run: () => void, ms: number) => () => void;
  /** How long a command may take to exit after SIGTERM before SIGKILL. */
  graceMs: number;
}

const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

const realDeps: TogetherDeps = {
  spawn,
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms).unref();
    return () => clearTimeout(timer);
  },
  graceMs: 5000,
};

/** The environment a command runs with: the base, then its own variables. */
export function environmentOf(
  command: Command,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...base, ...command.env };
}

/** The exit code of a child. Being stopped by a stop signal is not a failure. */
function exitCodeOf(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (code !== null) return code;
  return signal && STOP_SIGNALS.includes(signal) ? 0 : 1;
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * Runs the commands with the terminal's output. When one exits, or `stop` is
 * called, the rest get SIGTERM, and SIGKILL after `graceMs` if they are still
 * running. `done` settles once every command has exited, with the code of the
 * first one to exit, or 0 after a `stop`.
 */
export function runTogether(
  commands: Command[],
  deps: Partial<TogetherDeps> = {},
): Together {
  const { spawn, schedule, graceMs } = { ...realDeps, ...deps };
  const children = commands.map((command) =>
    spawn(command.file, command.args, {
      stdio: 'inherit',
      env: environmentOf(command),
    }),
  );
  let firstCode: number | undefined;
  let cancelKill: (() => void) | undefined;

  const stop = (): void => {
    const running = children.filter(isRunning);
    if (running.length === 0) return;
    for (const child of running) child.kill('SIGTERM');
    cancelKill ??= schedule(() => {
      for (const child of children.filter(isRunning)) child.kill('SIGKILL');
    }, graceMs);
  };
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
  ).then(() => {
    cancelKill?.();
    return firstCode ?? 0;
  });

  return { stop, done };
}
