'use strict';

const { formatDuration, formatNumber, formatPercent, pad } = require('../src');

console.log(formatDuration(90061000));
console.log(formatNumber(9876543.21));
console.log(formatPercent(0.0425));
console.log(`${pad.right('name', 8)}|${pad.left('42', 5)}`);
