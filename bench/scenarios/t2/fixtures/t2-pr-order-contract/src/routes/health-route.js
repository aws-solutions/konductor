export function healthRoute() {
  return {
    statusCode: 200,
    body: { ok: true, service: 'orders', version: '3.8.0' }
  };
}
