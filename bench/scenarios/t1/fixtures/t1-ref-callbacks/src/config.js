'use strict';

const defaults = Object.freeze({ concurrency: 2, retries: 0, beforeWrite: null, onFileStart: null, onFileDone: null });

function optionsFor(input) {
  const value = input || {};
  const options = { ...defaults, ...value };
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new TypeError('concurrency must be a positive integer');
  if (!Number.isInteger(options.retries) || options.retries < 0) throw new TypeError('retries must be a non-negative integer');
  return options;
}

module.exports = { defaults, optionsFor };
