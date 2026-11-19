'use strict';

function requiredClientMethod(name) {
  return () => { throw new Error(`Cloud client method is not configured: ${name}`); };
}

function createCloudClient() {
  return {
    listBucket: requiredClientMethod('listBucket'),
    putObject: requiredClientMethod('putObject'),
    passRole: requiredClientMethod('passRole'),
    updateFunctionCode: requiredClientMethod('updateFunctionCode'),
    publishVersion: requiredClientMethod('publishVersion'),
    createInvalidation: requiredClientMethod('createInvalidation'),
    updateAlias: requiredClientMethod('updateAlias')
  };
}

function createFakeClient(calls = []) {
  const record = (action, resource, params = {}) => {
    calls.push({ action, resource, params });
    return { action, resource, params };
  };
  return {
    listBucket: (resource) => record('s3:ListBucket', resource),
    putObject: (resource, params) => record('s3:PutObject', resource, params),
    passRole: (resource, params) => record('iam:PassRole', resource, params),
    updateFunctionCode: (resource, params) => record('lambda:UpdateFunctionCode', resource, params),
    publishVersion: (resource, params) => ({ Version: '17', ...record('lambda:PublishVersion', resource, params) }),
    createInvalidation: (resource, params) => record('cloudfront:CreateInvalidation', resource, params),
    updateAlias: (resource, params) => record('lambda:UpdateAlias', resource, params)
  };
}

module.exports = { createCloudClient, createFakeClient };
