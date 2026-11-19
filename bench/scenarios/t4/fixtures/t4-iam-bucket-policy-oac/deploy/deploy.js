#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Simple deploy script - in reality this would use AWS SDK
// but for this task we just validate configuration

function validateConfig(config) {
  console.log(`Validating ${config.environment} configuration...`);
  
  // Check bucket policies exist
  const policyFiles = [
    'infra/buckets/assets-policy.json',
    'infra/buckets/downloads-policy.json',
    'infra/buckets/logs-policy.json'
  ];
  
  for (const policyFile of policyFiles) {
    const policyPath = path.join(__dirname, '..', policyFile);
    if (!fs.existsSync(policyPath)) {
      throw new Error(`Missing policy file: ${policyFile}`);
    }
    
    try {
      const content = fs.readFileSync(policyPath, 'utf8');
      JSON.parse(content);
      console.log(`✓ ${policyFile} is valid JSON`);
    } catch (error) {
      throw new Error(`Invalid JSON in ${policyFile}: ${error.message}`);
    }
  }
  
  console.log(`Configuration validated for ${config.environment}`);
}

function main() {
  const args = process.argv.slice(2);
  const environment = args[0] || 'staging';
  
  if (!['staging', 'production'].includes(environment)) {
    console.error('Usage: node deploy/deploy.js [staging|production]');
    process.exit(1);
  }
  
  const configPath = path.join(__dirname, '..', 'infra', 'cdn-config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Missing config file: ${configPath}`);
    process.exit(1);
  }
  
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.environment = environment;
    validateConfig(config);
    
    console.log('\nReady to deploy. In a real scenario:');
    console.log(`1. Update S3 bucket policies for ${environment}`);
    console.log('2. Upload assets to S3');
    console.log('3. Create CloudFront invalidation');
    console.log('4. Verify deployment');
    
  } catch (error) {
    console.error(`Deployment error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateConfig };