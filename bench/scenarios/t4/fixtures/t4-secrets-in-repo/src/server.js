const { createHttpServer } = require('./http');

function startServer(config) {
  const server = createHttpServer();
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => resolve(server));
  });
}

module.exports = { startServer };
