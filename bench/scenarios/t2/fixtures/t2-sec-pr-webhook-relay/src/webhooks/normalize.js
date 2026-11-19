export function normalizeEvent(provider, envelope) {
  return {
    id: envelope.id,
    provider,
    kind: envelope.kind,
    receivedAt: new Date().toISOString(),
    payload: envelope.payload
  };
}
