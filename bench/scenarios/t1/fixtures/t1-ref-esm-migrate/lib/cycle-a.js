'use strict';
const cycleB = require('./cycle-b');
function value() { return 'cycle-a'; }
module.exports = { value, partner: cycleB.value };
