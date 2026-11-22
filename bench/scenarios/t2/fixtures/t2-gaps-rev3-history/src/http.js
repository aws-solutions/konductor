export function json(status, body) {
  return { status, body, headers: { 'content-type': 'application/json' } };
}

export function ok(body) { return json(200, body); }
export function created(body) { return json(201, body); }
export function badRequest(message) { return json(400, { error: message }); }
