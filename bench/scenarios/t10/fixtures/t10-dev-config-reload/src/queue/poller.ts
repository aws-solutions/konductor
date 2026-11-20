import { loadConfig } from '../config/loader.ts';
import type { QueueClient } from './types.ts';

const { pollIntervalMs, workerConcurrency } = loadConfig();

export function createPoller(queue: QueueClient) {
  return {
    intervalMs: pollIntervalMs,
    batchSize: workerConcurrency,
    pull: () => queue.pull(workerConcurrency)
  };
}
