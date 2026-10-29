'use strict';

const { formatDuration } = require('./duration');
const { formatNumber } = require('./number');
const { formatPercent } = require('./percent');
const pad = require('./pad');

module.exports = { formatDuration, formatNumber, formatPercent, pad };
