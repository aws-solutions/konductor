const { loadConfig } = require('./config');
const { startServer } = require('./server');

async function main(env = process.env) {
  const config = loadConfig(env);
  return startServer(config);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
