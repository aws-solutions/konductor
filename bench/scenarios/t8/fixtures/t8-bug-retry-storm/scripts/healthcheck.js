'use strict';

const { loadConfig } = require('../src/config');
console.log(JSON.stringify({ service: loadConfig().service, status: 'ok' }));
