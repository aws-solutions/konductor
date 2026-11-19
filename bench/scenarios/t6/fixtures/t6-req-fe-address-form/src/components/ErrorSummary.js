'use strict';

function errorSummary(errors) {
  return Object.entries(errors).map(([field, message]) => ({ field, message }));
}

module.exports = { errorSummary };
