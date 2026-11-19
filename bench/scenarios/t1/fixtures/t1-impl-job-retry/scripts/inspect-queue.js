const path = require('node:path');
const { JobQueue } = require('../src/job-queue');
const { formatTable } = require('../src/format');

async function main() {
  const queue = new JobQueue({ filePath: path.join(__dirname, '..', 'data', 'jobs.json') });
  console.log(formatTable(await queue.list()));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
