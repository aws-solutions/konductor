import fs from 'node:fs';
import path from 'node:path';
import { validateConfig } from './schema.ts';
import type { WorkerConfig } from './types.ts';

export function loadConfig(rootDir = '.', env: Record<string, string | undefined> = process.env): WorkerConfig {
  const worker = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/worker.json'), 'utf8'));
  const limits = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/limits.json'), 'utf8'));
  const value = { ...worker, ...limits } as Record<string, unknown>;
  const names: Record<string, string> = {
    pollIntervalMs: 'WORKER_POLL_INTERVAL_MS', maxAttempts: 'WORKER_MAX_ATTEMPTS', leaseSeconds: 'WORKER_LEASE_SECONDS',
    logLevel: 'WORKER_LOG_LEVEL', queueName: 'WORKER_QUEUE_NAME', region: 'WORKER_REGION', workerConcurrency: 'WORKER_CONCURRENCY',
    maxPayloadBytes: 'WORKER_MAX_PAYLOAD_BYTES', jobTimeoutMs: 'WORKER_JOB_TIMEOUT_MS', backoffMs: 'WORKER_BACKOFF_MS'
  };
  for (const [key, variable] of Object.entries(names)) if (env[variable] !== undefined) value[key] = ['logLevel', 'queueName', 'region'].includes(key) ? env[variable] : Number(env[variable]);
  return validateConfig(value);
}
