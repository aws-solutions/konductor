#!/usr/bin/env node
'use strict';

// Generate ARNs for reference
// This is a development utility, not used in production

const fs = require('fs');
const path = require('path');

function generateARNs(config) {
  console.log('ARN Reference:\n');
  
  const accountId = config.accountId;
  
  console.log('S3 Bucket ARNs:');
  console.log('===============');
  
  const stages = ['staging', 'production'];
  const bucketTypes = ['assets', 'downloads', 'logs'];
  
  for (const stage of stages) {
    console.log(`\n${stage.toUpperCase()}:`);
    for (const type of bucketTypes) {
      const bucketName = config.bucketNames[stage][type];
      console.log(`  ${type}: arn:aws:s3:::${bucketName}`);
      console.log(`  ${type}/*: arn:aws:s3:::${bucketName}/*`);
    }
  }
  
  console.log('\nCloudFront Distribution ARNs:');
  console.log('============================');
  for (const [stage, dist] of Object.entries(config.distributions)) {
    console.log(`${stage}: ${dist.arn}`);
  }
  
  console.log('\nIAM Role ARN (example):');
  console.log('======================');
  console.log(`arn:aws:iam::${accountId}:role/deploy-role`);
}

function main() {
  const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Missing CDN config file');
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    generateARNs(config);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateARNs };