#!/usr/bin/env node
'use strict';
const cp = require('node:child_process');
const version = require('../package.json').version;
const branch = cp.execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'trunk') { console.error('release must run from trunk'); process.exit(1); }
const tag = 'v' + version;
console.log('ready to create ' + tag);
