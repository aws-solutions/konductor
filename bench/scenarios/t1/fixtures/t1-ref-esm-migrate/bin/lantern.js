#!/usr/bin/env node
'use strict';
const { run } = require('../cli');
try {
  process.exitCode = run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
