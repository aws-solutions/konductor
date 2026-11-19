import { createServer } from './http/server.js';
import { MemoryStore } from './store/memory-store.js';
import { config } from './config.js';

const server = createServer(new MemoryStore());
server.listen(config.port, () => console.log(`payments listening on ${config.port}`));
