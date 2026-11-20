'use strict';

const service = require('../config/service.json');
console.log(JSON.stringify({ service: service.serviceName, healthy: true }));
