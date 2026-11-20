#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'examples');
console.log(fs.readdirSync(dir).filter((name) => name.endsWith('.wlf')).join('\n'));
