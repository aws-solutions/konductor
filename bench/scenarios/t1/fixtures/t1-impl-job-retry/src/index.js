const path = require('node:path');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { JobQueue } = require('./job-queue');
const { createHandlers } = require('./handlers');
const { WorkerRunner } = require('./runner');

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const queue = new JobQueue({ filePath: path.join(__dirname, '..', config.queueFile) });
  const runner = new WorkerRunner({ queue, handlers: createHandlers(logger), logger });
  await runner.run();
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
