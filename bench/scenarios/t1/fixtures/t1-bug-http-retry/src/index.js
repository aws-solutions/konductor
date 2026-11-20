'use strict';

const client = require('./client');
const cache = require('./cache');

module.exports = { ...client, clearCache: cache.clear };
