import { loadConfig } from '../config/loader.ts';
import type { WorkerConfig } from '../config/types.ts';
import type { QueueClient } from './types.ts';

type ConfigSource = { getSnapshot: () => WorkerConfig };

export function createPoller(queue: QueueClient, source?: ConfigSource) {
  const get = source ? () => source.getSnapshot() : () => loadConfig();
  return {
    get intervalMs() { return get().pollIntervalMs; },
    get batchSize() { return get().workerConcurrency; },
    pull: () => { const config = get(); return queue.pull(config.workerConcurrency); }
  };
}
