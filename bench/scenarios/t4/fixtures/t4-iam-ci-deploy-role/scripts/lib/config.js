'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('../../scripts/validate-config');

const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');

function loadConfig(stage) {
  const file = stage === 'production' ? 'production.json' : stage === 'staging' ? 'staging.json' : null;
  if (!file) throw new Error(`Unknown stage: ${stage}`);
  const config = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join('; '));
  return {
    ...config,
    bucketArn: `arn:aws:s3:::${config.bucketName}`,
    distributionArn: `arn:aws:cloudfront::${config.accountId}:distribution/${config.distributionId}`,
    functionArn: `arn:aws:lambda:${config.region}:${config.accountId}:function:${config.functionName}`,
    executionRoleArn: `arn:aws:iam::${config.accountId}:role/${config.executionRoleName}`,
    aliasArn: `arn:aws:lambda:${config.region}:${config.accountId}:function:${config.functionName}:${config.liveAlias}`
  };
}

module.exports = { loadConfig, CONFIG_DIR };
