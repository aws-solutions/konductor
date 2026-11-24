import { createServer } from 'node:http';
import { loadConfig } from './config';
import { healthResponse } from './health';

const config = loadConfig(process.env);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(healthResponse()));
});

server.listen(config.port, () => {
  process.stdout.write(`harborline listening on ${config.port}\n`);
});
