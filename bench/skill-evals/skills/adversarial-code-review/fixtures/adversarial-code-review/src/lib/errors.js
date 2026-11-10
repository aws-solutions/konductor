'use strict';

function toHttpError(err) {
  if (err.name === 'ConditionalCheckFailedException') {
    return { status: 409, body: { message: 'Conflict' } };
  }
  if (err.name === 'ValidationError') {
    return { status: 400, body: { message: err.message } };
  }
  return { status: 500, body: { message: 'Internal error' } };
}

module.exports = { toHttpError };
