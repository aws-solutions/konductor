#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2)).then((code) => {
  if (code) process.exitCode = code;
}).catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
