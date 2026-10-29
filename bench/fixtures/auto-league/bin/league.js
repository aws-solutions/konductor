#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { run } = require('../src/cli');

const { code, out } = run(process.argv.slice(2), { dataDir: path.join(__dirname, '..', 'data') });
process.stdout.write(out);
process.exitCode = code;
