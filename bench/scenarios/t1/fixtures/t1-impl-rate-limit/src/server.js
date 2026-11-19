const http = require('node:http');
const { createApp } = require('./app');
const { loadConfig } = require('./config');

const config = loadConfig();
const server = http.createServer(createApp({ config }));
server.listen(Number(process.env.PORT || config.port), process.env.HOST || config.host, () => {
  process.stdout.write(JSON.stringify({ event: 'listening', port: server.address().port }) + '\n');
});

function stop() {
  server.close(() => process.exit(0));
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
