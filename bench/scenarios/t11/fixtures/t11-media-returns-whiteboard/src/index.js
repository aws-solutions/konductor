'use strict';
const lifecycle = require('./returns/lifecycle');
const { createMemoryStore } = require('./returns/store');
module.exports = { ...lifecycle, createMemoryStore };
