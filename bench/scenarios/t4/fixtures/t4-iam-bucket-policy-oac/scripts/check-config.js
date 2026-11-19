#!/usr/bin/env node
'use strict';

// Simple config validation

const fs = require('fs');
const path = require('path');

function checkConfig(config) {
  const errors = [];
  
  // Check account ID
  if (!config.accountId || !/^\d{12}$/.test(config.accountId)) {
    errors.push('Invalid account ID');
  }
  
  // Check distributions
  if (!config.distributions || typeof config.distributions !== 'object') {
    errors.push('Missing distributions');
  } else {
    for (const env of ['staging', 'production']) {
      if (!config.distributions[env]) {
        errors.push(`Missing ${env} distribution`);
      } else {
        if (!config.distributions[env].id) errors.push(`Missing ${env} distribution ID`);
        if (!config.distributions[env].arn) errors.push(`Missing ${env} distribution ARN`);
      }
    }
  }
  
  // Check bucket names
  if (!config.bucketNames || typeof config.bucketNames !== 'object') {
    errors.push('Missing bucket names');
  } else {
    for (const env of ['staging', 'production']) {
      if (!config.bucketNames[env]) {
        errors.push(`Missing ${env} bucket names`);
      } else {
        for (const type of ['assets', 'downloads', 'logs']) {
          if (!config.bucketNames[env][type]) {
            errors.push(`Missing ${env}.${type} bucket name`);
          }
        }
      }
    }
  }
  
  return errors;
}

function main() {
  const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Missing config file');
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const errors = checkConfig(config);
    
    if (errors.length > 0) {
      console.error('Configuration errors:');
      errors.forEach(error => console.error(`  - ${error}`));
      process.exit(1);
    } else {
      console.log('✓ Configuration is valid');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { checkConfig };