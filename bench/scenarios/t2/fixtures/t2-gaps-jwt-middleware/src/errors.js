class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function badRequest(message) { return new HttpError(400, 'bad_request', message); }
function unauthorized(message = 'authentication required') { return new HttpError(401, 'unauthorized', message); }
function forbidden(message = 'permission denied') { return new HttpError(403, 'forbidden', message); }

module.exports = { HttpError, badRequest, unauthorized, forbidden };
