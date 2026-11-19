'use strict';

const path = require('node:path');
const { FileStore } = require('./store');
const { retry } = require('./retry');
const { optionsFor } = require('./config');
const { discoverFiles } = require('./steps/discover');
const { parseText } = require('./steps/parse');
const { serializeRecord } = require('./steps/serialize');
const { validateInput } = require('./steps/validate');
const { withCallback } = require('./bridge');

async function invokeHook(hook, name) {
  if (typeof hook !== 'function') return;
  if (hook.length >= 2) {
    await new Promise((resolve, reject) => {
      let called = false;
      const done = (err) => { if (called) return; called = true; if (err) reject(err); else resolve(); };
      try { hook(name, done); } catch (err) { done(err); }
    });
    return;
  }
  await hook(name);
}

async function processFileAsync(inputFile, outputDir, inputOptions) {
  const options = inputOptions || {};
  const store = options.store || new FileStore();
  const text = await store.readText(inputFile);
  const record = parseText(text, path.basename(inputFile));
  const outputFile = path.join(outputDir, path.basename(inputFile, '.txt') + '.json');
  await invokeHook(options.beforeWrite, path.basename(inputFile));
  await retry(() => store.writeJson(outputFile, record), options);
  return { source: path.basename(inputFile), output: path.basename(outputFile) };
}

function processFile(inputFile, outputDir, inputOptions, callback) {
  if (typeof inputOptions === 'function') { callback = inputOptions; inputOptions = {}; }
  return withCallback(processFileAsync(inputFile, outputDir, inputOptions), callback);
}

async function runPipelineAsync(inputDir, outputDir, inputOptions) {
  const options = optionsFor(inputOptions);
  await validateInput(inputDir);
  const files = await discoverFiles(inputDir);
  const results = new Array(files.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const name = path.basename(files[index]);
      await invokeHook(options.onFileStart, name);
      results[index] = await processFileAsync(files[index], outputDir, options);
      await invokeHook(options.onFileDone, name);
    }
  }
  const workerCount = Math.min(options.concurrency, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { processed: results.length, files: results };
}

function runPipeline(inputDir, outputDir, inputOptions, callback) {
  if (typeof inputOptions === 'function') { callback = inputOptions; inputOptions = {}; }
  return withCallback(runPipelineAsync(inputDir, outputDir, inputOptions), callback);
}

module.exports = { processFile, runPipeline };
