export type Response = { status: number; body: Record<string, unknown> };

export function route(path: string): Response {
  if (path === '/health') return { status: 200, body: { ok: true } };
  if (path === '/ready') return { status: 200, body: { ready: true } };
  return { status: 404, body: { error: 'not_found' } };
}
