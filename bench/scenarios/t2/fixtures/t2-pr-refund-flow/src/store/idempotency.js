export class IdempotencyStore {
  constructor(store) { this.store = store; }

  read(key) { return this.store.idempotency.get(key); }
  write(key, value) { this.store.idempotency.set(key, structuredClone(value)); }
}

export function requestKey(request) {
  return request.headers?.['idempotency-key'] || request.headers?.['x-request-id'];
}
