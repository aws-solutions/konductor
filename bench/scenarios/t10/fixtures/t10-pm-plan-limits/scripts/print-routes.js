#!/usr/bin/env node
'use strict';
const { routes } = require('../src/http/router');
for (const route of routes) console.log(`${route.method} ${route.path}`);
