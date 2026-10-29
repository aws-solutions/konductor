'use strict';

const { formatDuration } = require('./duration');
const { formatNumber } = require('./number');
const { formatPercent } = require('./percent');
const { formatBytes } = require('./bytes');
const pad = require('./pad');

module.exports = { formatDuration, formatNumber, formatPercent, formatBytes, pad };
