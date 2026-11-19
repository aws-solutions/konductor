const { createServer } = require('./server');
const { loadConfig } = require('./config');

const config = loadConfig();
const server = createServer({ config });
server.listen(config.port, () => {
  process.stdout.write(`harbor-payments listening on ${config.port}\n`);
});
