import { loadConfig } from './config.js';
import { makeLogger } from './logger.js';
import { makeDeliveryStore } from './storage/deliveries.js';
import { startServer } from './server.js';

const config = loadConfig();
const logger = makeLogger(config.logLevel);
logger.info('configured provider key', { id: config.publicKeyId });
startServer(config, logger, makeDeliveryStore());
logger.info(`relay gateway listening on ${config.port}`);
