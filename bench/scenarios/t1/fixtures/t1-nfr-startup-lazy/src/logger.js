'use strict';

function debug(message) {
  if (process.env.ATLAS_DEBUG === '1') process.stderr.write(`[debug] ${message}
`);
}

module.exports = { debug };
