'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { loadConfig } = require('./lib/config');
const { createCloudClient } = require('./lib/cloud-client');
const { buildManifest } = require('./lib/manifest');
const { publicDir, apiDir } = require('./lib/paths');
const { readText } = require('./lib/fs-utils');

const DEFAULT_MANIFEST_PATH = '.lantern-deploy.json';
const DEFAULT_SLEEP = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// A manifest written for another stage is ignored, so a production deploy after a staging one uploads everything.
function loadPreviousManifest(manifestPath, stage) {
  if (!fs.existsSync(manifestPath)) return { version: '1.0', files: {} };
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(content);
    return parsed.version === '1.0' && (stage === undefined || parsed.stage === stage) ? parsed : { version: '1.0', files: {} };
  } catch {
    return { version: '1.0', files: {} };
  }
}

function saveManifest(manifestPath, stage, fileHashes) {
  const manifest = {
    version: '1.0',
    stage,
    files: fileHashes
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function retryWithBackoff(fn, resource, sleepFn, maxRetries = 3) {
  let lastError;
  // maxRetries is number of retries, so total attempts = maxRetries + 1
  const maxAttempts = maxRetries + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(resource);
    } catch (error) {
      lastError = error;
      const isRetryableError = !error.message.includes('Validation error:');
      // If non-retryable error or this is the last attempt, throw
      if (!isRetryableError || attempt === maxAttempts - 1) {
        throw new Error(`failed to upload ${resource}`);
      }
      // Sleep before next retry: 100ms, 200ms, 400ms for attempts 0, 1, 2
      const delay = Math.pow(2, attempt) * 100;
      await sleepFn(delay);
    }
  }
  throw lastError;
}

async function deploy({ 
  stage, 
  client = createCloudClient(), 
  releaseId = process.env.RELEASE_ID || 'local-release',
  dryRun = false,
  manifestPath = DEFAULT_MANIFEST_PATH,
  sleep = DEFAULT_SLEEP
}) {
  const config = loadConfig(stage);
  const manifest = buildManifest(publicDir);
  const previousManifest = loadPreviousManifest(manifestPath, stage);
  const fileHashes = {};
  const plannedUploads = [];
  const skippedFiles = [];
  
  if (!dryRun) {
    client.listBucket(config.bucketArn);
  }

  for (const asset of manifest) {
    const content = readText(asset.file);
    const hash = hashContent(content);
    fileHashes[asset.key] = hash;
    
    if (previousManifest.files[asset.key] === hash) {
      skippedFiles.push(asset.key);
      continue;
    }
    
    plannedUploads.push(asset.key);
    
    if (!dryRun) {
      await retryWithBackoff(
        () => client.putObject(`${config.bucketArn}/${asset.key}`, {
          body: content,
          releaseId,
          contentType: path.extname(asset.file) === '.css' ? 'text/css' : 'text/html'
        }),
        asset.key,
        sleep
      );
    }
  }

  const functionUpdate = {
    source: path.join(apiDir, 'health.js')
  };
  
  if (!dryRun) {
    client.passRole(config.executionRoleArn, { iamPassedToService: 'lambda.amazonaws.com' });
    client.updateFunctionCode(config.functionArn, { ...functionUpdate, releaseId });
    const version = client.publishVersion(config.functionArn, { releaseId });
    
    if (stage === 'production') {
      client.createInvalidation(config.distributionArn, { paths: ['/*'], releaseId });
    }
    
    saveManifest(manifestPath, stage, fileHashes);
    
    return { 
      stage, 
      releaseId, 
      uploaded: manifest.map((item) => item.key), 
      skipped: skippedFiles,
      version: version.Version || 'unknown' 
    };
  } else {
    // Dry-run output
    const output = {
      stage,
      plannedUploads,
      skippedFiles,
      functionUpdate: {
        functionArn: config.functionArn,
        source: functionUpdate.source
      }
    };
    
    if (stage === 'production') {
      output.invalidation = {
        distributionId: config.distributionArn,
        paths: ['/*']
      };
    }
    
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return output;
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const stage = args[0];
  let dryRun = false;
  let manifestPath = DEFAULT_MANIFEST_PATH;
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--manifest-path' && i + 1 < args.length) {
      manifestPath = args[++i];
    }
  }
  
  deploy({ stage, dryRun, manifestPath })
    .then((result) => {
      if (!dryRun) process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error}\n`);
      process.exitCode = 1;
    });
}

module.exports = { deploy, hashContent, retryWithBackoff, loadPreviousManifest, saveManifest };