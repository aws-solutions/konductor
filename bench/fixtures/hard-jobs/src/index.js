'use strict';

const { runBatch } = require('./batch');
const { createDedupeStore } = require('./dedupe');

module.exports = { runBatch, createDedupeStore };
