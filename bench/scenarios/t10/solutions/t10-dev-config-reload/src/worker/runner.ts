import { loadConfig } from '../config/loader.ts';
import type { WorkerConfig } from '../config/types.ts';
import type { Delivery } from '../queue/types.ts';

type ConfigSource = { getSnapshot: () => WorkerConfig };

export function workerSettings(source?: ConfigSource) {
  const config = source ? source.getSnapshot() : loadConfig();
  return { workerConcurrency: config.workerConcurrency, maxAttempts: config.maxAttempts };
}

export async function runDelivery(delivery: Delivery, handle: (payload: Record<string, unknown>, config?: WorkerConfig) => Promise<void>, source?: ConfigSource) {
  const config = source ? source.getSnapshot() : loadConfig();
  await handle(delivery.payload, config);
  return { id: delivery.id, attempt: delivery.attempt };
}
