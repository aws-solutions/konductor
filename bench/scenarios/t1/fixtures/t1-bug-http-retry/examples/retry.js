'use strict';

const { request } = require('../src');

async function fetchWithRetry(url) {
  return request(url, { retries: 2, retryDelayMs: 250 });
}

module.exports = { fetchWithRetry };
