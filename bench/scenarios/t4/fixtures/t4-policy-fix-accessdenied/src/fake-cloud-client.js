'use strict';

const config = require('./config');

class FakeCloudClient {
  constructor(items = [{ id: 'r-100', day: '2025-02-03', amount: 12 }]) {
    this.items = items;
    this.calls = [];
    this.sequence = 0;
  }

  record(action, resource, context = {}, request = {}) {
    this.calls.push({ action, resource, context: { ...context }, request: { ...request } });
  }

  async query(params) {
    const resource = params.IndexName ? config.indexArn : config.tableArn;
    this.record('dynamodb:Query', resource, {}, params);
    return { Items: this.items.slice() };
  }

  s3Request(action, params) {
    const resource = `${config.bucketArn}/${params.Key}`;
    const context = {};
    if (params.ServerSideEncryption !== undefined) {
      context['s3:x-amz-server-side-encryption'] = params.ServerSideEncryption;
    }
    if (params.SSEKMSKeyId !== undefined) {
      context['s3:x-amz-server-side-encryption-aws-kms-key-id'] = params.SSEKMSKeyId;
    }
    this.record(action, resource, context, params);
  }

  async putObject(params) {
    this.s3Request('s3:PutObject', params);
    return { ETag: '"fake-etag-001"' };
  }

  async createMultipartUpload(params) {
    this.s3Request('s3:PutObject', params);
    this.sequence += 1;
    return { UploadId: `upload-${this.sequence}` };
  }

  async uploadPart(params) {
    this.s3Request('s3:UploadPart', params);
    return { ETag: `"part-${params.PartNumber}"` };
  }

  async completeMultipartUpload(params) {
    this.s3Request('s3:PutObject', params);
    return { Location: `${config.bucketArn}/${params.Key}` };
  }
}

module.exports = { FakeCloudClient };
