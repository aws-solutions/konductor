'use strict';

const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { createCloudClient } = require('./lib/cloud-client');
const { buildManifest } = require('./lib/manifest');
const { publicDir, apiDir } = require('./lib/paths');
const { readText } = require('./lib/fs-utils');

async function deploy({ stage, client = createCloudClient(), releaseId = process.env.RELEASE_ID || 'local-release' }) {
  const config = loadConfig(stage);
  const manifest = buildManifest(publicDir);
  client.listBucket(config.bucketArn);

  for (const asset of manifest) {
    client.putObject(`${config.bucketArn}/${asset.key}`, {
      body: readText(asset.file),
      releaseId,
      contentType: path.extname(asset.file) === '.css' ? 'text/css' : 'text/html'
    });
  }

  client.passRole(config.executionRoleArn, { iamPassedToService: 'lambda.amazonaws.com' });
  client.updateFunctionCode(config.functionArn, {
    source: path.join(apiDir, 'health.js'),
    releaseId
  });
  const version = client.publishVersion(config.functionArn, { releaseId });
  if (stage === 'production') {
    client.createInvalidation(config.distributionArn, { paths: ['/*'], releaseId });
  }
  return { stage, releaseId, uploaded: manifest.map((item) => item.key), version: version.Version || 'unknown' };
}

if (require.main === module) {
  deploy({ stage: process.argv[2] }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { deploy };
