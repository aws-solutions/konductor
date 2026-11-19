'use strict';

const { createFileStore } = require('./file-store');

function createStore(config) {
  return createFileStore(config.dataDirectory);
}

module.exports = { createStore };
