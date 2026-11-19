#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function checkJsonFiles(dir) {
  const files = fs.readdirSync(dir);
  let hasErrors = false;
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        JSON.parse(content);
        console.log(`✓ ${filePath}`);
      } catch (error) {
        console.error(`✗ ${filePath}: ${error.message}`);
        hasErrors = true;
      }
    }
  }
  
  return hasErrors;
}

function main() {
  console.log('Linting JSON files...\n');
  
  let hasErrors = false;
  
  // Check infra directory
  const infraDir = path.join(__dirname, '..', 'infra');
  if (fs.existsSync(infraDir)) {
    console.log('Checking infra/...');
    hasErrors = checkJsonFiles(infraDir) || hasErrors;
    
    // Check subdirectories
    const subdirs = ['buckets', 'iam'];
    for (const subdir of subdirs) {
      const subdirPath = path.join(infraDir, subdir);
      if (fs.existsSync(subdirPath)) {
        console.log(`Checking infra/${subdir}/...`);
        hasErrors = checkJsonFiles(subdirPath) || hasErrors;
      }
    }
  }
  
  console.log('\n' + (hasErrors ? 'Lint failed' : 'All JSON files are valid'));
  process.exit(hasErrors ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { checkJsonFiles };