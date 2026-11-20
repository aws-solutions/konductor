import type { WorkerConfig } from './types.ts';

export const CONFIG_KEYS = [
  'pollIntervalMs', 'maxAttempts', 'leaseSeconds', 'logLevel', 'queueName',
  'region', 'workerConcurrency', 'maxPayloadBytes', 'jobTimeoutMs', 'backoffMs'
];

export function validateConfig(value: Record<string, unknown>): WorkerConfig {
  const result = { ...value } as WorkerConfig;
  if (result.pollIntervalMs <= 0 || result.maxAttempts < 1 || result.leaseSeconds <= 0) throw new Error('invalid worker timing');
  if (result.workerConcurrency < 1 || result.maxPayloadBytes < 1 || result.jobTimeoutMs <= 0 || result.backoffMs < 0) throw new Error('invalid worker limit');
  if (typeof result.logLevel !== 'string' || typeof result.queueName !== 'string' || typeof result.region !== 'string') throw new Error('invalid worker text');
  return result;
}
