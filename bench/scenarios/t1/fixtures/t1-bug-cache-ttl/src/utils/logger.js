'use strict';

function logger(level, message, details = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  process.stdout.write(`[${level}] ${message}${suffix}\n`);
}

module.exports = { logger };
