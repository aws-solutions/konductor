const http = require('node:http');
const { createApp } = require('./app');
const { loadConfig } = require('./config');

const config = loadConfig();
const app = createApp(config);
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
  const result = await app({ method: request.method, url: request.url, headers: request.headers, body });
  response.writeHead(result.status, result.headers);
  response.end(result.body === null ? '' : JSON.stringify(result.body));
});
server.listen(config.port, config.host, () => console.log(`roster listening on ${config.host}:${config.port}`));
