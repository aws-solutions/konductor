'use strict';

const path = require('node:path');
const { FileStore } = require('./store');
const { retry } = require('./retry');
const { optionsFor } = require('./config');
const { discoverFiles } = require('./steps/discover');
const { parseText } = require('./steps/parse');
const { serializeRecord } = require('./steps/serialize');
const { validateInput } = require('./steps/validate');
const { once } = require('./util');

function callHook(hook, name, callback) {
  if (typeof hook !== 'function') return callback(null);
  try { return hook(name, callback); } catch (err) { return callback(err); }
}

function processFile(inputFile, outputDir, options, callback) {
  options = options || {};
  const store = options.store || new FileStore();
  store.readText(inputFile, (readError, text) => {
    if (readError) return callback(readError);
    const record = parseText(text, path.basename(inputFile));
    const outputFile = path.join(outputDir, path.basename(inputFile, '.txt') + '.json');
    callHook(options.beforeWrite, path.basename(inputFile), (hookError) => {
      if (hookError) return callback(hookError);
      retry((next) => store.writeJson(outputFile, record, next), options, (writeError) => {
        if (writeError) return callback(writeError);
        callback(null, { source: path.basename(inputFile), output: path.basename(outputFile) });
      });
    });
  });
}

function runPipeline(inputDir, outputDir, inputOptions, callback) {
  const done = once(callback);
  let options;
  try { options = optionsFor(inputOptions); } catch (err) { return done(err); }
  validateInput(inputDir, (validationError) => {
    if (validationError) return done(validationError);
    discoverFiles(inputDir, (discoverError, files) => {
      if (discoverError) return done(discoverError);
      const results = new Array(files.length);
      let cursor = 0;
      let complete = 0;
      let active = 0;
      let failed = false;
      function launch() {
        while (!failed && active < options.concurrency && cursor < files.length) {
          const index = cursor++;
          active += 1;
          const name = path.basename(files[index]);
          callHook(options.onFileStart, name, (startError) => {
            if (startError) return finish(startError, index);
            processFile(files[index], outputDir, options, (err, result) => {
              if (err) return finish(err, index);
              results[index] = result;
              callHook(options.onFileDone, name, (doneError) => finish(doneError, index));
            });
          });
        }
        if (!files.length) return done(null, { processed: 0, files: [] });
      }
      function finish(err, index) {
        active -= 1;
        complete += 1;
        if (err && !failed) { failed = true; return done(err); }
        if (complete === files.length) return done(null, { processed: results.filter(Boolean).length, files: results });
        launch();
      }
      launch();
    });
  });
}

module.exports = { processFile, runPipeline };
