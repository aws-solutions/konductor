'use strict';

const { GRACE_DAYS, DAY_MS } = require('./rules');

const graceDeadline = (failedAt) => failedAt + GRACE_DAYS * DAY_MS;

module.exports = { graceDeadline };
