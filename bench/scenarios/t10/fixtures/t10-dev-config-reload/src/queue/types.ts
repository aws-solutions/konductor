export type Delivery = { id: string; payload: Record<string, unknown>; attempt: number };
export type QueueClient = { pull: (limit: number) => Promise<Delivery[]>; ack: (id: string) => Promise<void> };
