export function healthResponse() {
  return { status: 200, body: JSON.stringify({ ok: true, service: 'relay-gateway' }) };
}
