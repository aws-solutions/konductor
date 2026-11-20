import type { WorkerConfig } from './types.ts';

export const CONFIG_KEYS = [
  'pollIntervalMs', 'maxAttempts', 'leaseSeconds', 'logLevel', 'queueName',
  'region', 'workerConcurrency', 'maxPayloadBytes', 'jobTimeoutMs', 'backoffMs'
] as const;

export function validateConfig(value: Record<string, unknown>): WorkerConfig {
  for (const key of Object.keys(value)) if (!(CONFIG_KEYS as readonly string[]).includes(key)) throw new Error(`unknown configuration key: ${key}`);
  const numberKeys = ['pollIntervalMs', 'maxAttempts', 'leaseSeconds', 'workerConcurrency', 'maxPayloadBytes', 'jobTimeoutMs', 'backoffMs'];
  for (const key of numberKeys) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key]) || !Number.isFinite(value[key] as number)) throw new Error(`${key} must be an integer`);
  }
  if ((value.pollIntervalMs as number) <= 0 || (value.maxAttempts as number) < 1 || (value.leaseSeconds as number) <= 0) throw new Error('invalid worker timing');
  if ((value.workerConcurrency as number) < 1 || (value.maxPayloadBytes as number) < 1 || (value.jobTimeoutMs as number) <= 0 || (value.backoffMs as number) < 0) throw new Error('invalid worker limit');
  for (const key of ['logLevel', 'queueName', 'region']) if (typeof value[key] !== 'string' || value[key].length === 0) throw new Error(`${key} must be non-empty text`);
  if (!['debug', 'info', 'warn', 'error'].includes(value.logLevel as string)) throw new Error('unsupported log level');
  return { ...value } as WorkerConfig;
}
