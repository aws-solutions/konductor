import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_KEYS, validateConfig } from './schema.ts';
import type { WorkerConfig } from './types.ts';

export const CONFIG_FILES = ['config/worker.json', 'config/limits.json'];
export type ReloadReason = 'startup' | 'sighup' | 'file';
export type ConfigChange = { changed: string[]; previous: WorkerConfig; current: WorkerConfig; reason: ReloadReason };
export type ReloadResult = { accepted: boolean; config: WorkerConfig; changed: string[]; error: ConfigReloadError | null };
export type ConfigReloadErrorCode = 'CONFIG_READ' | 'CONFIG_PARSE' | 'CONFIG_SCHEMA' | 'CONFIG_UNKNOWN_KEY' | 'CONFIG_ENV';

export class ConfigReloadError extends Error {
  code: ConfigReloadErrorCode;
  constructor(code: ConfigReloadErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigReloadError';
    this.code = code;
  }
}

type ConfigEnv = Record<string, string | undefined>;
export type ConfigReloaderOptions = {
  rootDir?: string;
  env?: ConfigEnv;
  debounceMs?: number;
  watch?: (onChange: () => void) => () => void;
  signal?: { on: (name: string, listener: () => void) => unknown; off?: (name: string, listener: () => void) => unknown };
  schedule?: (fn: () => void, delayMs: number) => unknown;
  cancelSchedule?: (id: unknown) => void;
};

const ENV_NAMES: Record<keyof WorkerConfig, string> = {
  pollIntervalMs: 'WORKER_POLL_INTERVAL_MS', maxAttempts: 'WORKER_MAX_ATTEMPTS', leaseSeconds: 'WORKER_LEASE_SECONDS',
  logLevel: 'WORKER_LOG_LEVEL', queueName: 'WORKER_QUEUE_NAME', region: 'WORKER_REGION', workerConcurrency: 'WORKER_CONCURRENCY',
  maxPayloadBytes: 'WORKER_MAX_PAYLOAD_BYTES', jobTimeoutMs: 'WORKER_JOB_TIMEOUT_MS', backoffMs: 'WORKER_BACKOFF_MS'
};
const TEXT_KEYS = new Set(['logLevel', 'queueName', 'region']);
const sameConfig = (a: WorkerConfig, b: WorkerConfig) => CONFIG_KEYS.filter((key) => a[key as keyof WorkerConfig] !== b[key as keyof WorkerConfig]);
const immutable = (config: WorkerConfig) => Object.freeze({ ...config });

function objectFrom(text: string, fileName: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch (error) { throw new ConfigReloadError('CONFIG_PARSE', `cannot parse ${fileName}`, { cause: error }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigReloadError('CONFIG_SCHEMA', `${fileName} must contain an object`);
  return value as Record<string, unknown>;
}

function applyEnvironment(value: Record<string, unknown>, env: ConfigEnv) {
  for (const key of CONFIG_KEYS as (keyof WorkerConfig)[]) {
    const name = ENV_NAMES[key];
    if (env[name] === undefined) continue;
    const raw = env[name] as string;
    if (raw.trim() === '') throw new ConfigReloadError('CONFIG_ENV', `${name} is empty`);
    if (TEXT_KEYS.has(key)) value[key] = raw;
    else {
      const number = Number(raw);
      if (!Number.isInteger(number) || !Number.isFinite(number)) throw new ConfigReloadError('CONFIG_ENV', `${name} must be an integer`);
      value[key] = number;
    }
  }
}

export function parseConfig(workerText: string, limitsText: string, env: ConfigEnv = process.env): WorkerConfig {
  const worker = objectFrom(workerText, 'config/worker.json');
  const limits = objectFrom(limitsText, 'config/limits.json');
  const allowed = new Set(CONFIG_KEYS);
  for (const [name, source] of [['worker.json', worker], ['limits.json', limits]] as const) {
    for (const key of Object.keys(source)) if (!allowed.has(key)) throw new ConfigReloadError('CONFIG_UNKNOWN_KEY', `${name} contains unknown key ${key}`);
  }
  const value = { ...worker, ...limits };
  applyEnvironment(value, env);
  try { return immutable(validateConfig(value)); } catch (error) {
    if (error instanceof ConfigReloadError) throw error;
    throw new ConfigReloadError('CONFIG_SCHEMA', error instanceof Error ? error.message : 'configuration failed validation', { cause: error });
  }
}

export function loadConfig(options: { rootDir?: string; env?: ConfigEnv } = {}): WorkerConfig {
  const rootDir = options.rootDir ?? '.';
  let workerText: string;
  let limitsText: string;
  try {
    workerText = fs.readFileSync(path.join(rootDir, CONFIG_FILES[0]), 'utf8');
    limitsText = fs.readFileSync(path.join(rootDir, CONFIG_FILES[1]), 'utf8');
  } catch (error) {
    throw new ConfigReloadError('CONFIG_READ', 'could not read configuration files', { cause: error });
  }
  return parseConfig(workerText, limitsText, options.env ?? process.env);
}

function defaultWatch(rootDir: string, onChange: () => void) {
  const handles = CONFIG_FILES.map((file) => fs.watch(path.join(rootDir, file), onChange));
  return () => handles.forEach((handle) => handle.close());
}

export class ConfigReloader {
  private readonly options: Required<Pick<ConfigReloaderOptions, 'rootDir' | 'debounceMs'>> & ConfigReloaderOptions;
  private current: WorkerConfig | null = null;
  private cleanupWatch: (() => void) | null = null;
  private cleanupSignal: (() => void) | null = null;
  private timer: unknown = null;
  private listeners = new Set<(change: ConfigChange) => void>();

  constructor(options: ConfigReloaderOptions = {}) {
    this.options = { rootDir: '.', debounceMs: 100, ...options };
  }

  start(): WorkerConfig {
    if (!this.current) this.current = loadConfig({ rootDir: this.options.rootDir, env: this.options.env });
    if (!this.cleanupWatch) this.cleanupWatch = (this.options.watch ?? ((onChange) => defaultWatch(this.options.rootDir, onChange)))(( ) => this.scheduleFileReload());
    if (!this.cleanupSignal && this.options.signal) {
      const listener = () => { this.reload('sighup'); };
      this.options.signal.on('SIGHUP', listener);
      this.cleanupSignal = () => this.options.signal?.off?.('SIGHUP', listener);
    }
    return this.current;
  }

  private scheduleFileReload() {
    if (this.timer !== null) this.options.cancelSchedule?.(this.timer);
    const schedule = this.options.schedule ?? ((fn: () => void, delay: number) => setTimeout(fn, delay));
    this.timer = schedule(() => { this.timer = null; this.reload('file'); }, this.options.debounceMs);
  }

  flushPending(): ReloadResult | null {
    if (this.timer === null) return null;
    this.options.cancelSchedule?.(this.timer);
    this.timer = null;
    return this.reload('file');
  }

  getSnapshot(): WorkerConfig {
    if (!this.current) return this.start();
    return this.current;
  }

  withSnapshot<T>(work: (config: WorkerConfig) => T | Promise<T>): Promise<T> {
    const snapshot = this.getSnapshot();
    return Promise.resolve().then(() => work(snapshot));
  }

  reload(reason: Exclude<ReloadReason, 'startup'> = 'file'): ReloadResult {
    const previous = this.getSnapshot();
    try {
      const current = loadConfig({ rootDir: this.options.rootDir, env: this.options.env });
      const changed = sameConfig(previous, current);
      this.current = current;
      if (changed.length) {
        const change = { changed, previous, current, reason };
        for (const listener of this.listeners) {
          try { listener(change); } catch { /* observers cannot invalidate an accepted snapshot */ }
        }
      }
      return { accepted: true, config: current, changed, error: null };
    } catch (error) {
      const reloadError = error instanceof ConfigReloadError ? error : new ConfigReloadError('CONFIG_SCHEMA', 'configuration reload failed', { cause: error });
      return { accepted: false, config: previous, changed: [], error: reloadError };
    }
  }

  onChange(listener: (change: ConfigChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    if (this.timer !== null) this.options.cancelSchedule?.(this.timer);
    this.timer = null;
    this.cleanupWatch?.();
    this.cleanupSignal?.();
    this.cleanupWatch = null;
    this.cleanupSignal = null;
  }
}
