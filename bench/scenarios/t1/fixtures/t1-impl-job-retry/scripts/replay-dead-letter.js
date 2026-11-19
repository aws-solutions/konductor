const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const file = path.join(__dirname, '..', 'data', 'jobs.json');
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  console.log(`dead letters: ${state.deadLetter.length}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
