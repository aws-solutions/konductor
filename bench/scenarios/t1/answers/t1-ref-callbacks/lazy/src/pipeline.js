'use strict';

const path = require('node:path');
const fs = require('node:fs');
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
  if (typeof options === 'function') { callback = options; options = {}; }
  options = options || {};
  const store = options.store || new FileStore();
  
  const promise = (async () => {
    const text = await store.readText(inputFile);
    const record = parseText(text, path.basename(inputFile));
    const outputFile = path.join(outputDir, path.basename(inputFile, '.txt') + '.json');
    
    await new Promise((resolve, reject) => {
      callHook(options.beforeWrite, path.basename(inputFile), (hookError) => {
        if (hookError) return reject(hookError);
        retry((next) => store.writeJson(outputFile, record, next), options, (writeError) => {
          if (writeError) return reject(writeError);
          resolve();
        });
      });
    });
    
    return { source: path.basename(inputFile), output: path.basename(outputFile) };
  })();
  
  if (callback) {
    promise.then(r => callback(null, r), e => callback(e));
  }
  return promise;
}

function runPipeline(inputDir, outputDir, inputOptions, callback) {
  if (typeof inputOptions === 'function') { callback = inputOptions; inputOptions = {}; }
  const done = once(callback);
  
  const promise = (async () => {
    let options;
    try { options = optionsFor(inputOptions); } catch (err) { throw err; }
    
    await new Promise((resolve, reject) => {
      validateInput(inputDir, (validationError) => {
        if (validationError) return reject(validationError);
        resolve();
      });
    });
    
    const files = await new Promise((resolve, reject) => {
      discoverFiles(inputDir, (discoverError, files) => {
        if (discoverError) return reject(discoverError);
        resolve(files);
      });
    });
    
    const results = new Array(files.length);
    let cursor = 0;
    let complete = 0;
    let active = 0;
    let failed = false;
    
    return await new Promise((resolve, reject) => {
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
        if (!files.length) return resolve({ processed: 0, files: [] });
      }
      function finish(err, index) {
        active -= 1;
        complete += 1;
        if (err && !failed) { failed = true; return reject(err); }
        if (complete === files.length) return resolve({ processed: results.filter(Boolean).length, files: results });
        launch();
      }
      launch();
    });
  })();
  
  if (callback) {
    promise.then(r => done(null, r), e => done(e));
  }
  return promise;
}

module.exports = { processFile, runPipeline };
