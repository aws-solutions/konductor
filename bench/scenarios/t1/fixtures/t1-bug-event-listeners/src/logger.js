'use strict';

function createLogger(level = 'info') {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = levels[level] ?? levels.info;
  return Object.fromEntries(Object.entries(levels).map(([name, value]) => [name, (...args) => {
    if (value >= threshold && process.env.NODE_ENV !== 'test') console.error(`[${name}]`, ...args);
  }]));
}

module.exports = { createLogger };
