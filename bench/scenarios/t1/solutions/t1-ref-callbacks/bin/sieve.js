#!/usr/bin/env node
'use strict';

const { runPipeline } = require('../src');

function parseArgs(argv) {
  const result = { concurrency: 2, retries: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '--output' || arg === '--concurrency' || arg === '--retries') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      if (arg === '--input') result.input = value;
      if (arg === '--output') result.output = value;
      if (arg === '--concurrency') result.concurrency = Number(value);
      if (arg === '--retries') result.retries = Number(value);
      i += 1;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  if (!result.input || !result.output || !Number.isInteger(result.concurrency) || result.concurrency < 1 || !Number.isInteger(result.retries) || result.retries < 0) {
    throw new Error('usage: sieve --input DIR --output DIR [--concurrency N] [--retries N]');
  }
  return result;
}

function setExit(code, done) {
  if (require.main === module) process.exitCode = code;
  if (done) done(code);
}

function main(argv, io, done) {
  io = io || { stdout: process.stdout, stderr: process.stderr };
  try {
    const options = parseArgs(argv || process.argv.slice(2));
    runPipeline(options.input, options.output, options, (err, summary) => {
      if (err) {
        io.stderr.write(`sieve: ${err.message}\n`);
        setExit(1, done);
        return;
      }
      io.stdout.write(`Processed ${summary.processed} file(s) into ${options.output}\n`);
      setExit(0, done);
    });
  } catch (err) {
    io.stderr.write(`sieve: ${err.message}\n`);
    setExit(2, done);
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main, parseArgs };
