export function eventKind(provider, body) {
  if (body?.kind) return body.kind;
  if (provider === 'source') return 'push';
  return 'payment.updated';
}
