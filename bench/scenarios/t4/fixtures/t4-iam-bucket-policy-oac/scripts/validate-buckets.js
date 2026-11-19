#!/usr/bin/env node
'use strict';

// Utility to validate bucket naming conventions
// Not used in deployment, just for development

const fs = require('fs');
const path = require('path');

function validateBucketNames(config) {
  console.log('Validating bucket names...');
  
  const stages = ['staging', 'production'];
  const bucketTypes = ['assets', 'downloads', 'logs'];
  
  for (const stage of stages) {
    for (const type of bucketTypes) {
      const bucketName = config.bucketNames[stage][type];
      if (!bucketName) {
        console.error(`Missing ${stage}.${type} bucket name`);
        return false;
      }
      
      // Basic S3 bucket name validation
      if (bucketName.length < 3 || bucketName.length > 63) {
        console.error(`Invalid length for ${stage}.${type}: ${bucketName}`);
        return false;
      }
      
      if (!/^[a-z0-9.-]+$/.test(bucketName)) {
        console.error(`Invalid characters in ${stage}.${type}: ${bucketName}`);
        return false;
      }
      
      console.log(`✓ ${stage}.${type}: ${bucketName}`);
    }
  }
  
  return true;
}

function main() {
  const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Missing CDN config file');
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const valid = validateBucketNames(config);
    process.exit(valid ? 0 : 1);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateBucketNames };