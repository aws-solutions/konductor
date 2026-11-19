#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');
const status = run(process.argv.slice(2));
if (typeof status === 'number') process.exitCode = status;
