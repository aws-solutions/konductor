'use strict';
const cycleA = require('./cycle-a');
function value() { return 'cycle-b'; }
module.exports = { value, partner: cycleA.value };
