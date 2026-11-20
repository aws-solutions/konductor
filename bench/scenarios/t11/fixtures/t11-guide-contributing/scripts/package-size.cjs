#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const files = fs.readdirSync(path.join(__dirname, '..', 'src'));
console.log('package contains ' + files.length + ' source entries');
