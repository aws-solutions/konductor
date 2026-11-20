#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');
process.exitCode = run(process.argv.slice(2));
