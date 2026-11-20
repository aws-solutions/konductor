'use strict';

const fs = require('node:fs');
const service = require('../config/service.json');
const limits = require('../config/limits.json');
if (!service.serviceName || service.port < 1 || limits.maxItems < 1) process.exit(1);
console.log('configuration ok');
