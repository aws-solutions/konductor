#!/usr/bin/env node
'use strict';

// Simple test helper to verify Terraform files exist
const fs = require('fs');
const path = require('path');

function checkFileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    console.log(`✓ ${filePath}`);
    return true;
  } catch (err) {
    console.log(`✗ ${filePath} - ${err.message}`);
    return false;
  }
}

function main() {
  console.log('Checking required files...\n');
  
  const requiredFiles = [
    'main.tf',
    'variables.tf',
    'outputs.tf',
    'README.md',
    'CHANGELOG.md',
    'docs/architecture.md',
    'docs/reporting.md',
    'review/PR-142.md',
    'modules/network/main.tf',
    'modules/network/variables.tf',
    'modules/network/outputs.tf',
    'modules/storage/main.tf',
    'modules/storage/variables.tf',
    'modules/database/main.tf',
    'modules/database/variables.tf',
    'modules/compute/main.tf',
    'modules/compute/variables.tf',
    'modules/iam/main.tf',
    'modules/iam/variables.tf',
    'modules/logging/main.tf',
    'modules/logging/variables.tf',
    'environments/staging/terraform.tfvars',
    'environments/prod/terraform.tfvars'
  ];

  let allExist = true;
  for (const file of requiredFiles) {
    if (!checkFileExists(path.join(__dirname, file))) {
      allExist = false;
    }
  }

  console.log('\n' + (allExist ? 'All files exist!' : 'Some files missing.'));
  process.exit(allExist ? 0 : 1);
}

if (require.main === module) {
  main();
}