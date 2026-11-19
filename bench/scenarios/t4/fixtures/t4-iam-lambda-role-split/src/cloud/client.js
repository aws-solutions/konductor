'use strict';

class CloudClient {
  constructor({ stage = 'staging', recorder = null } = {}) {
    this.stage = stage;
    this.recorder = recorder;
  }

  request(action, resource, details = {}) {
    if (this.recorder) this.recorder({ action, resource, details, stage: this.stage });
    return Promise.resolve({ ok: true });
  }
}

module.exports = { CloudClient };
