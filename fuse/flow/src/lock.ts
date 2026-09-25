// SPDX-License-Identifier: Apache-2.0
// Lock file around every write to a workstream state file. Created with
// O_EXCL so two processes cannot both hold it; a lock older than the stale
// threshold is treated as abandoned by a crashed process and removed.

import { closeSync, openSync, rmSync, statSync, writeSync } from "node:fs";

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export interface LockOptions {
  timeoutMs: number;
  staleMs: number;
  pollMs: number;
}

export function lockOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LockOptions {
  const num = (key: string, fallback: number) => {
    const v = env[key];
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    timeoutMs: num("FUSE_FLOW_LOCK_TIMEOUT_MS", 5000),
    staleMs: num("FUSE_FLOW_LOCK_STALE_MS", 30000),
    pollMs: num("FUSE_FLOW_LOCK_POLL_MS", 50),
  };
}

function tryAcquire(path: string): boolean {
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
    closeSync(fd);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

function stealIfStale(path: string, staleMs: number): boolean {
  try {
    const st = statSync(path);
    if (Date.now() - st.mtimeMs > staleMs) {
      rmSync(path, { force: true });
      return true;
    }
  } catch {
    // Vanished between attempts; the next acquire will succeed or retry.
  }
  return false;
}

export function withLock<T>(path: string, opts: LockOptions, fn: () => T): T {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    if (tryAcquire(path)) break;
    if (stealIfStale(path, opts.staleMs)) continue;
    if (Date.now() >= deadline) {
      throw new LockError(
        `another fuse-flow process holds ${path}; retry, or remove the file if no process is running`,
      );
    }
    Bun.sleepSync(opts.pollMs);
  }
  try {
    return fn();
  } finally {
    rmSync(path, { force: true });
  }
}
