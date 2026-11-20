'use strict';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFound(message = 'Resource not found') {
  return new ApiError(404, 'not_found', message);
}

function badRequest(message) {
  return new ApiError(400, 'bad_request', message);
}

module.exports = { ApiError, notFound, badRequest };
