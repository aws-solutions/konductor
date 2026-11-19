#!/usr/bin/env node
'use strict';

// OLD DEPLOY SCRIPT - DO NOT USE
// Kept for reference only

// This was the old deployment script before we added CDN support
// It directly modifies bucket policies which is no longer safe

const fs = require('fs');
const path = require('path');

// OBSOLETE - This function makes buckets public
function makeBucketPublic(bucketName) {
  console.log(`WARNING: Making ${bucketName} public!`);
  
  const policy = {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: '*',
      Action: ['s3:GetObject'],
      Resource: `arn:aws:s3:::${bucketName}/*`
    }]
  };
  
  // This is dangerous and should not be used
  return policy;
}

// OBSOLETE - Old way of handling logs
function setupLogging(bucketName) {
  // This allows any principal in the account to write
  // which is too permissive
  return {
    Version: '2012-10-17',
    Statement: [{
      Effect: 'Allow',
      Principal: { AWS: `arn:aws:iam::111122223333:root` },
      Action: 's3:PutObject',
      Resource: `arn:aws:s3:::${bucketName}/*`
    }]
  };
}

// This function is never called but remains in the codebase
function unusedHelper() {
  // Some commented out code that doesn't make sense anymore
  // const oldConfig = loadConfig('old-config.yaml'); // file doesn't exist
  // return processConfig(oldConfig); // function doesn't exist
}

module.exports = {
  makeBucketPublic,
  setupLogging,
  unusedHelper
};