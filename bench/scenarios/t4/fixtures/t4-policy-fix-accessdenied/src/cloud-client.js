'use strict';

class CloudClient {
  async query() {
    throw new Error('query is not configured');
  }

  async putObject() {
    throw new Error('putObject is not configured');
  }

  async createMultipartUpload() {
    throw new Error('createMultipartUpload is not configured');
  }

  async uploadPart() {
    throw new Error('uploadPart is not configured');
  }

  async completeMultipartUpload() {
    throw new Error('completeMultipartUpload is not configured');
  }
}

module.exports = { CloudClient };
