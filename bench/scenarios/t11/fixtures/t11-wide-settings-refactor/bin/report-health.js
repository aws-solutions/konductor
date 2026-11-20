#!/usr/bin/env node
'use strict';

const { serviceTag } = require('../lib');
const { timeout } = require('../apps/dispatch/manifest')();
console.log(serviceTag('dispatch') + ' timeout=' + timeout);
