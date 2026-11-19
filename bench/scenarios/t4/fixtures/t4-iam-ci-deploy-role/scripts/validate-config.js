'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = ['stage', 'region', 'accountId', 'bucketName', 'distributionId', 'functionName', 'executionRoleName', 'liveAlias', 'sitePrefix'];

function validateConfig(config) {
  const errors = [];
  for (const key of REQUIRED) if (!config || typeof config[key] !== 'string' || !config[key]) errors.push(`missing ${key}`);
  if (config && config.accountId && !/^\d{12}$/.test(config.accountId)) errors.push('accountId must contain 12 digits');
  if (config && config.stage && !['staging', 'production'].includes(config.stage)) errors.push('stage is not supported');
  if (config && config.sitePrefix && !config.sitePrefix.endsWith('/')) errors.push('sitePrefix must end with a slash');
  return errors;
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'config');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const config = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const errors = validateConfig(config);
    if (errors.length) throw new Error(`${file}: ${errors.join(', ')}`);
    process.stdout.write(`${file}: ok\n`);
  }
}

module.exports = { validateConfig };
