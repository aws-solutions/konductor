export function json(status, body) { return { status, body }; }
export function errorResponse(error) { return json(500, { code: 'internal_error', message: error.message }); }
