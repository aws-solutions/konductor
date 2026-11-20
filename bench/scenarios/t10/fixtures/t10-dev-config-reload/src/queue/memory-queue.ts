import type { Delivery, QueueClient } from './types.ts';

export function memoryQueue(initial: Delivery[] = []): QueueClient & { acknowledged: string[] } {
  const pending = [...initial];
  const acknowledged: string[] = [];
  return {
    acknowledged,
    async pull(limit) { return pending.splice(0, limit); },
    async ack(id) { acknowledged.push(id); }
  };
}
