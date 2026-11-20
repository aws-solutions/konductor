'use strict';

function statusFor(error) {
  return error && Number.isInteger(error.status) ? error.status : 500;
}

function handleError(error) {
  return { status: statusFor(error), body: { code: error.code || 'INTERNAL_ERROR', message: error.message } };
}

module.exports = { statusFor, handleError };
