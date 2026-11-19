'use strict';

const { CloudClient } = require('./client');

class FakeCloudClient extends CloudClient {
  constructor(options = {}) {
    const calls = [];
    super({ ...options, recorder: (call) => calls.push(call) });
    this.calls = calls;
  }
}

module.exports = { FakeCloudClient };
