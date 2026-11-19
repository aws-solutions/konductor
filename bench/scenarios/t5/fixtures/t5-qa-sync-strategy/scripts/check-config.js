const { loadConfig } = require('../src/config');
const config = loadConfig(process.argv[2]);
if (!Number.isInteger(config.batchSize) || config.batchSize < 1) throw new Error('invalid batch size');
console.log('configuration ok');
