'use strict';

function timing(start, end) {
  return { durationMs: Math.max(0, Number(end) - Number(start)) };
}

module.exports = { timing };
