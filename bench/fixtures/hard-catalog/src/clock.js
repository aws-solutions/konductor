'use strict';

const systemClock = { now: () => Date.now() };
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { systemClock, realSleep };
