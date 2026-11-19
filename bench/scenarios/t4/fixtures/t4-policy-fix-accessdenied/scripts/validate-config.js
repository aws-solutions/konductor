'use strict';

const config = require('../src/config');

for (const field of ['bucketName', 'prefix', 'tableName', 'indexName', 'kmsKeyId']) {
  if (!config[field]) throw new Error(`missing config field: ${field}`);
}

process.stdout.write('configuration looks complete\n');
