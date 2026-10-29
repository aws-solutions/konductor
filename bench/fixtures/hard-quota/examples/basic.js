'use strict';

const { createLimiter } = require('../src');

const limiter = createLimiter({ limit: 3, windowSec: 60 });
for (let i = 0; i < 5; i++) {
  console.log(i + 1, limiter.check('demo-user'));
}
