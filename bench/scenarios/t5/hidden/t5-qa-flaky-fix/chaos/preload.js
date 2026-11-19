const path = require('node:path');

if (process.env.CHAOS === 'clock') {
  const fixed = new Date('2026-02-28T23:59:50.000Z').getTime();
  Date.now = () => fixed;
}

if (process.env.CHAOS === 'random') {
  const seed = Number(process.env.CHAOS_SEED || 7) >>> 0;
  Math.random = () => seed / 0x100000000;
}

if (process.env.CHAOS === 'timers') {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    const adjusted = delay > 0 && delay <= 10 ? delay * 10 : delay;
    return originalSetTimeout(callback, adjusted, ...args);
  };
}

if (process.env.CHAOS === 'state') {
  const helpers = require(path.resolve(process.cwd(), 'test/helpers.js'));
  if (helpers.sharedLimiter) helpers.sharedLimiter.allow('email');
}
