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

/**
 * Invoke a hook function if provided, handling errors safely.
 * @param {Function|null} hook - Hook function or null
 * @param {string} name - Argument to pass to hook
 * @returns {Promise<void>}
 */
async function invokeHook(hook, name) {
  if (typeof hook !== 'function') return;
  return new Promise((resolve, reject) => {
    try {
      hook(name, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Process a single input file and write its JSON record.
 * @param {string} inputFile - Path to input .txt file
 * @param {string} outputDir - Directory for output .json files
 * @param {Object} options - Processing options
 * @param {Function} [callback] - Optional error-first callback
 * @returns {Promise<{source: string, output: string}>}
 */
async function processFileAsync(inputFile, outputDir, options) {
  options = options || {};
  const store = options.store || new FileStore();
  
  // Read and parse
  const text = await store.readText(inputFile);
  const record = parseText(text, path.basename(inputFile));
  const outputFile = path.join(outputDir, path.basename(inputFile, '.txt') + '.json');
  
  // beforeWrite hook
  await invokeHook(options.beforeWrite, path.basename(inputFile));
  
  // Write with retry
  await new Promise((resolve, reject) => {
    retry(
      (done) => store.writeJson(outputFile, record, done),
      options,
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
  
  return {
    source: path.basename(inputFile),
    output: path.basename(outputFile)
  };
}

function processFile(inputFile, outputDir, options, callback) {
  // Handle optional options parameter
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  
  const promise = processFileAsync(inputFile, outputDir, options);
  
  if (typeof callback === 'function') {
    const done = once(callback);
    promise.then(
      result => done(null, result),
      error => done(error)
    );
  }
  
  return promise;
}

/**
 * Run the full pipeline on an input directory.
 * @param {string} inputDir - Directory containing .txt files
 * @param {string} outputDir - Directory for output .json files
 * @param {Object} inputOptions - Pipeline options
 * @param {number} inputOptions.concurrency - Max concurrent files (default: 2)
 * @param {number} inputOptions.retries - Write retry count (default: 0)
 * @param {Function} inputOptions.beforeWrite - Hook before each write
 * @param {Function} inputOptions.onFileStart - Hook when file starts
 * @param {Function} inputOptions.onFileDone - Hook when file completes
 * @param {Function} [callback] - Optional error-first callback
 * @returns {Promise<{processed: number, files: Array<{source: string, output: string}>}>}
 */
async function runPipelineAsync(inputDir, outputDir, inputOptions) {
  const options = optionsFor(inputOptions);
  
  // Validate input directory
  await new Promise((resolve, reject) => {
    validateInput(inputDir, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  
  // Discover sorted .txt files
  const files = await new Promise((resolve, reject) => {
    discoverFiles(inputDir, (err, files) => {
      if (err) reject(err);
      else resolve(files);
    });
  });
  
  // Handle empty directory
  if (files.length === 0) {
    return { processed: 0, files: [] };
  }
  
  // Process files with concurrency limit, preserving input order
  const results = new Array(files.length);
  let cursor = 0;
  let completed = 0;
  let active = 0;
  let firstError = null;
  
  return new Promise((resolve, reject) => {
    const handleError = (err) => {
      if (!firstError) {
        firstError = err;
        reject(err);
      }
    };
    
    const processNext = () => {
      while (active < options.concurrency && cursor < files.length && !firstError) {
        const index = cursor++;
        const file = files[index];
        const name = path.basename(file);
        active++;
        
        // onFileStart hook
        invokeHook(options.onFileStart, name)
          .then(() => processFileAsync(file, outputDir, options))
          .then(result => {
            results[index] = result;
            return invokeHook(options.onFileDone, name);
          })
          .then(() => {
            active--;
            completed++;
            if (completed === files.length) {
              resolve({
                processed: results.filter(Boolean).length,
                files: results
              });
            } else {
              processNext();
            }
          })
          .catch(err => {
            active--;
            handleError(err);
          });
      }
    };
    
    processNext();
  });
}

function runPipeline(inputDir, outputDir, inputOptions, callback) {
  // Handle optional options parameter
  if (typeof inputOptions === 'function') {
    callback = inputOptions;
    inputOptions = {};
  }
  
  const promise = runPipelineAsync(inputDir, outputDir, inputOptions);
  
  if (typeof callback === 'function') {
    const done = once(callback);
    promise.then(
      result => done(null, result),
      error => done(error)
    );
  }
  
  return promise;
}

module.exports = { processFile, runPipeline };
