'use strict';

const { createWorker } = require('./worker');
const { createQueue } = require('./queue');

module.exports = { createWorker, createQueue };
