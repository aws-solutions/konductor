'use strict';
const a = require('./cycle-a');
const b = require('./cycle-b');
function cycleValue() { return `${a.value()}-${b.value()}`; }
module.exports = { cycleValue };
