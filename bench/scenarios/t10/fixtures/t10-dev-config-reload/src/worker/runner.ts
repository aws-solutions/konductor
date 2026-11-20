import { loadConfig } from '../config/loader.ts';
import type { Delivery } from '../queue/types.ts';

const { workerConcurrency, maxAttempts } = loadConfig();

export function workerSettings() {
  return { workerConcurrency, maxAttempts };
}

export async function runDelivery(delivery: Delivery, handle: (payload: Record<string, unknown>) => Promise<void>) {
  await handle(delivery.payload);
  return { id: delivery.id, attempt: delivery.attempt };
}
