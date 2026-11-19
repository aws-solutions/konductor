'use strict';

function version(release = 'local') {
  return { statusCode: 200, body: JSON.stringify({ release }) };
}

module.exports = { version };
